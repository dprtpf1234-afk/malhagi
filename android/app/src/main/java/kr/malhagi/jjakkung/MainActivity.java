package kr.malhagi.jjakkung;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ContentValues;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.ImageView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 말하기 짝꿍 앱.
 * - 웹앱(https://malhagi-one.vercel.app)을 앱 안의 웹뷰로 엽니다. 다른 주소는 휴대폰 브라우저로 엽니다.
 * - 웹뷰에는 '소리 내어 읽기'가 없어서, 휴대폰 음성 기능(TextToSpeech)을 window.MalhagiAndroid 로 연결합니다.
 *   (웹앱의 speech.js가 이 연결을 찾으면 브라우저 음성 기능 대신 사용)
 * - 기록 파일 내려받기(다운로드 폴더에 저장)와 불러오기(파일 고르기), 뒤로 가기, 전체화면을 앱에서 처리합니다.
 */
public class MainActivity extends Activity {
    private static final String HOME = "https://malhagi-one.vercel.app/";
    private static final String HOST = "malhagi-one.vercel.app";
    private static final int BACKGROUND = 0xFFFBF8F3;
    private static final int FILE_REQUEST = 1001;
    /** Chrome과 같은 방식: 특정 목소리를 고르지 않고, 휴대폰 설정의 기본 한국어 목소리를 씀 */
    private static final String DEFAULT_VOICE = "__default__";
    private static final Locale KOREAN = Locale.KOREA; // ko-KR (Chrome이 쓰는 값과 같음)
    /** 고품질 한국어 목소리가 있는 Google 음성 엔진을 먼저 씀 (없으면 휴대폰 기본 엔진) */
    private static final String GOOGLE_TTS = "com.google.android.tts";
    private static final String PREFS = "malhagi";

    private WebView web;
    private View splash;
    private TextToSpeech tts;
    private volatile boolean ttsReady = false;
    private volatile boolean immersive = false;
    private ValueCallback<Uri[]> fileCallback;
    private String enginePkg = GOOGLE_TTS;
    /** 인터넷 목소리로 읽는 중인 문장: 실패하면 기본 목소리로 다시 읽음 */
    private final Map<String, String[]> networkUtterances = new ConcurrentHashMap<>();

    private final UtteranceProgressListener progress = new UtteranceProgressListener() {
        @Override public void onStart(String id) { }
        @Override public void onDone(String id) { networkUtterances.remove(id); notifySpeech(id, "end"); }
        @Override public void onError(String id) { if (!retryWithDefault(id)) notifySpeech(id, "error"); }
        @Override public void onStop(String id, boolean interrupted) { networkUtterances.remove(id); notifySpeech(id, "end"); }
    };

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Window window = getWindow();
        window.setStatusBarColor(BACKGROUND);
        window.setNavigationBarColor(BACKGROUND);
        applySystemBars(false);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(BACKGROUND);

        web = new WebView(this);
        web.setBackgroundColor(BACKGROUND);
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        // 웹 화면이 뜨기 전까지 보이는 로고 (곧 웹앱의 움직이는 시작 화면으로 이어짐)
        FrameLayout cover = new FrameLayout(this);
        cover.setBackgroundColor(BACKGROUND);
        ImageView logo = new ImageView(this);
        logo.setImageResource(R.drawable.splash_logo);
        logo.setScaleType(ImageView.ScaleType.FIT_CENTER);
        int size = (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, 168, getResources().getDisplayMetrics());
        FrameLayout.LayoutParams logoParams = new FrameLayout.LayoutParams(size, size);
        logoParams.gravity = Gravity.CENTER;
        cover.addView(logo, logoParams);
        root.addView(cover, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        splash = cover;
        setContentView(root);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setTextZoom(100); // 글씨 크기는 웹앱의 '글씨 크기'로 조절 (휴대폰 글꼴 크기와 겹치지 않게)
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setSupportMultipleWindows(false);
        s.setUserAgentString(s.getUserAgentString() + " MalhagiApp/3.3.0");

        web.addJavascriptInterface(new Bridge(), "MalhagiAndroid");
        web.setWebViewClient(new Client());
        web.setWebChromeClient(new Chrome());

        SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        initTts(prefs.getString("tts_engine", GOOGLE_TTS));

        if (savedInstanceState != null) web.restoreState(savedInstanceState);
        else web.loadUrl(HOME);

        // 혹시 페이지가 늦게 떠도 로고 화면에 갇히지 않게
        root.postDelayed(this::hideSplash, 10000);
    }

    // ── 화면 ──

    private void applySystemBars(boolean full) {
        View decor = getWindow().getDecorView();
        if (full) {
            decor.setSystemUiVisibility(View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    | View.SYSTEM_UI_FLAG_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        } else {
            int flags = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
            if (Build.VERSION.SDK_INT >= 26) flags |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
            decor.setSystemUiVisibility(flags);
        }
    }

    private void hideSplash() {
        final View v = splash;
        if (v == null) return;
        splash = null;
        v.animate().alpha(0f).setDuration(250).withEndAction(() -> {
            ViewGroup parent = (ViewGroup) v.getParent();
            if (parent != null) parent.removeView(v);
        }).start();
    }

    private void openOutside(Uri uri) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (ActivityNotFoundException ignored) { }
    }

    private static boolean isOurs(Uri uri) {
        return uri != null && "https".equals(uri.getScheme()) && HOST.equals(uri.getHost());
    }

    private void showOffline() {
        String html = "<!DOCTYPE html><html lang='ko'><head><meta charset='utf-8'>"
                + "<meta name='viewport' content='width=device-width, initial-scale=1'>"
                + "<style>body{margin:0;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;"
                + "background:#FBF8F3;color:#2B2B2B;font-family:sans-serif;text-align:center;padding:24px;box-sizing:border-box}"
                + "h1{font-size:26px;margin:0 0 12px}p{font-size:20px;line-height:1.6;margin:0 0 28px}"
                + "a{display:block;width:100%;max-width:320px;padding:18px;border-radius:14px;background:#A8DADC;color:#2B2B2B;"
                + "font-size:22px;font-weight:bold;text-decoration:none}</style></head><body>"
                + "<h1>인터넷에 연결되어 있지 않아요</h1>"
                + "<p>처음 한 번은 인터넷이 필요해요.<br>와이파이나 데이터를 켠 뒤 다시 시도해 주세요.</p>"
                + "<a href='" + HOME + "'>다시 시도</a></body></html>";
        web.loadDataWithBaseURL(null, html, "text/html", "utf-8", null);
    }

    private class Client extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            String path = uri.getPath() == null ? "" : uri.getPath();
            if (isOurs(uri) && !path.endsWith(".apk")) return false;
            openOutside(uri); // 다른 사이트, 설치 파일은 휴대폰 브라우저로
            return true;
        }

        @Override
        public void onPageCommitVisible(WebView view, String url) {
            hideSplash();
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            hideSplash();
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (request.isForMainFrame()) showOffline();
        }
    }

    private class Chrome extends WebChromeClient {
        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (fileCallback != null) fileCallback.onReceiveValue(null);
            fileCallback = callback;
            // .json 파일이 회색으로 막히는 휴대폰이 있어 모든 파일을 고를 수 있게 함 (웹앱이 내용을 검사)
            Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType("*/*");
            try {
                startActivityForResult(Intent.createChooser(intent, "기록 파일 고르기"), FILE_REQUEST);
                return true;
            } catch (ActivityNotFoundException e) {
                fileCallback = null;
                callback.onReceiveValue(null);
                return false;
            }
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == FILE_REQUEST) {
            if (fileCallback != null) {
                Uri[] result = null;
                if (resultCode == RESULT_OK && data != null && data.getData() != null) result = new Uri[] { data.getData() };
                fileCallback.onReceiveValue(result);
                fileCallback = null;
            }
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (web != null) web.saveState(outState);
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (tts != null) tts.stop();
        if (web != null) web.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) web.onResume();
        if (immersive) applySystemBars(true);
    }

    @Override
    protected void onDestroy() {
        if (tts != null) {
            tts.stop();
            tts.shutdown();
            tts = null;
        }
        if (web != null) {
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }

    // ── 음성 ──

    private void notifySpeech(String id, String type) {
        if (id == null || !id.matches("[A-Za-z0-9_-]{1,40}")) return;
        final String js = "window.__malhagiTts && window.__malhagiTts('" + id + "','" + type + "')";
        runOnUiThread(() -> {
            if (web != null) web.evaluateJavascript(js, null);
        });
    }

    /** 음성 엔진 켜기 (요청한 엔진이 없으면 안드로이드가 휴대폰 기본 엔진을 씀) */
    private void initTts(String engine) {
        ttsReady = false;
        networkUtterances.clear();
        if (tts != null) {
            try { tts.shutdown(); } catch (Exception ignored) { }
        }
        enginePkg = engine;
        final TextToSpeech[] holder = new TextToSpeech[1];
        holder[0] = new TextToSpeech(getApplicationContext(), status -> {
            TextToSpeech t = holder[0];
            if (status != TextToSpeech.SUCCESS || t == null || t != tts) return;
            t.setLanguage(KOREAN);
            t.setOnUtteranceProgressListener(progress);
            ttsReady = true;
        }, engine);
        tts = holder[0];
    }

    /** 지금 쓰는 엔진의 패키지 이름 */
    private String currentEngine() {
        try {
            for (TextToSpeech.EngineInfo e : tts.getEngines()) if (e.name.equals(enginePkg)) return enginePkg;
            String d = tts.getDefaultEngine();
            return d == null ? "" : d;
        } catch (Exception e) {
            return "";
        }
    }

    private static String engineName(String pkg, String fallback) {
        if (pkg == null) return fallback == null ? "" : fallback;
        if (pkg.contains("google")) return "Google";
        if (pkg.contains("samsung") || pkg.contains("SMT")) return "삼성";
        return fallback == null ? pkg : fallback;
    }

    private String engineLabel() {
        String pkg = currentEngine();
        try {
            for (TextToSpeech.EngineInfo e : tts.getEngines()) if (e.name.equals(pkg)) return engineName(pkg, e.label);
        } catch (Exception ignored) { }
        return engineName(pkg, "");
    }

    /** 인터넷 목소리가 실패하면(인터넷 끊김 등) 같은 문장을 기본 목소리로 다시 읽음 */
    private boolean retryWithDefault(String id) {
        String[] r = networkUtterances.remove(id);
        if (r == null || tts == null) return false;
        try {
            tts.setLanguage(KOREAN);
            tts.setSpeechRate(Float.parseFloat(r[1]));
            return tts.speak(r[0], TextToSpeech.QUEUE_FLUSH, new Bundle(), id) == TextToSpeech.SUCCESS;
        } catch (Exception e) {
            return false;
        }
    }

    private Voice findVoice(String name) {
        if (tts == null || name == null || name.isEmpty()) return null;
        try {
            Set<Voice> voices = tts.getVoices();
            if (voices == null) return null;
            for (Voice v : voices) if (name.equals(v.getName())) return v;
        } catch (Exception ignored) { }
        return null;
    }

    /** 웹앱에서 window.MalhagiAndroid 로 부르는 기능들 */
    private class Bridge {
        @JavascriptInterface
        public boolean ready() {
            return ttsReady;
        }

        /** 한국어 목소리 목록 (JSON 배열). 맨 앞은 휴대폰 기본 목소리(Chrome과 같은 소리) */
        @JavascriptInterface
        public String voices() {
            JSONArray list = new JSONArray();
            if (!ttsReady || tts == null) return list.toString();
            try {
                JSONObject d = new JSONObject();
                d.put("name", DEFAULT_VOICE);
                d.put("voiceURI", DEFAULT_VOICE);
                d.put("lang", "ko-KR");
                d.put("localService", true);
                d.put("isDefault", true);
                d.put("engine", engineLabel());
                list.put(d);
                Set<Voice> voices = tts.getVoices();
                if (voices != null) {
                    for (Voice v : voices) {
                        Locale l = v.getLocale();
                        if (l == null || !"ko".equals(l.getLanguage())) continue;
                        Set<String> features = v.getFeatures();
                        if (features != null && features.contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED)) continue;
                        JSONObject o = new JSONObject();
                        o.put("name", v.getName());
                        o.put("voiceURI", v.getName());
                        o.put("lang", l.toLanguageTag());
                        o.put("localService", !v.isNetworkConnectionRequired());
                        o.put("quality", v.getQuality());
                        o.put("latency", v.getLatency());
                        list.put(o);
                    }
                }
            } catch (Exception ignored) { }
            return list.toString();
        }

        @JavascriptInterface
        public void speak(String id, String text, float rate, String voiceName) {
            if (!ttsReady || tts == null || text == null || text.isEmpty()) {
                notifySpeech(id, "error");
                return;
            }
            try {
                Voice v = DEFAULT_VOICE.equals(voiceName) ? null : findVoice(voiceName);
                if (v != null) tts.setVoice(v);
                else tts.setLanguage(KOREAN); // 기본 목소리로 되돌림
                float r = Math.max(0.3f, Math.min(2f, rate));
                tts.setSpeechRate(r);
                if (v != null && v.isNetworkConnectionRequired()) networkUtterances.put(id, new String[] { text, String.valueOf(r) });
                int r = tts.speak(text, TextToSpeech.QUEUE_FLUSH, new Bundle(), id);
                if (r != TextToSpeech.SUCCESS) notifySpeech(id, "error");
            } catch (Exception e) {
                notifySpeech(id, "error");
            }
        }

        /** 설치된 음성 엔진 목록 (JSON 배열: pkg, label, current) */
        @JavascriptInterface
        public String engines() {
            JSONArray list = new JSONArray();
            if (tts == null) return list.toString();
            try {
                String cur = currentEngine();
                for (TextToSpeech.EngineInfo e : tts.getEngines()) {
                    JSONObject o = new JSONObject();
                    o.put("pkg", e.name);
                    o.put("label", engineName(e.name, e.label));
                    o.put("current", e.name.equals(cur));
                    list.put(o);
                }
            } catch (Exception ignored) { }
            return list.toString();
        }

        /** 음성 엔진 바꾸기 (설치된 엔진만) */
        @JavascriptInterface
        public boolean setEngine(String pkg) {
            if (pkg == null || tts == null) return false;
            boolean found = false;
            try {
                for (TextToSpeech.EngineInfo e : tts.getEngines()) if (e.name.equals(pkg)) found = true;
            } catch (Exception ignored) { }
            if (!found) return false;
            getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString("tts_engine", pkg).apply();
            runOnUiThread(() -> initTts(pkg));
            return true;
        }

        @JavascriptInterface
        public void stop() {
            if (tts != null) tts.stop();
        }

        @JavascriptInterface
        public boolean speaking() {
            return tts != null && tts.isSpeaking();
        }

        @JavascriptInterface
        public boolean isFullscreen() {
            return immersive;
        }

        @JavascriptInterface
        public void setFullscreen(boolean on) {
            immersive = on;
            runOnUiThread(() -> applySystemBars(on));
        }

        /** 기록 파일을 휴대폰의 다운로드 폴더에 저장. 성공하면 "ok", 실패하면 "error" */
        @JavascriptInterface
        public String saveFile(String name, String text) {
            try {
                String safe = (name == null ? "malhagi.json" : name).replaceAll("[^0-9A-Za-z가-힣._-]", "_");
                if (!safe.endsWith(".json")) safe = safe + ".json";
                byte[] bytes = (text == null ? "" : text).getBytes(StandardCharsets.UTF_8);
                if (bytes.length > 20_000_000) return "error";
                if (Build.VERSION.SDK_INT >= 29) {
                    ContentValues values = new ContentValues();
                    values.put(MediaStore.MediaColumns.DISPLAY_NAME, safe);
                    values.put(MediaStore.MediaColumns.MIME_TYPE, "application/json");
                    values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
                    Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                    if (uri == null) return "error";
                    try (OutputStream out = getContentResolver().openOutputStream(uri)) {
                        if (out == null) return "error";
                        out.write(bytes);
                    }
                } else {
                    File dir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
                    if (dir == null) return "error";
                    try (FileOutputStream out = new FileOutputStream(new File(dir, safe))) {
                        out.write(bytes);
                    }
                }
                return "ok";
            } catch (Exception e) {
                return "error";
            }
        }
    }
}
