"""APK 서명 인증서의 SHA-256 지문을 public/.well-known/assetlinks.json 에 더합니다.

Chrome은 이 파일로 '이 앱이 malhagi-one.vercel.app 의 주인'임을 확인하고, 확인되면 주소창 없이 앱을 엽니다.
빌드마다 새 서명 키를 쓰므로, 예전에 설치한 앱도 계속 확인되도록 최근 지문 몇 개를 함께 남깁니다.
    python3 .github/scripts/assetlinks.py cert.der
"""
import hashlib, json, pathlib, sys

PACKAGE = 'kr.malhagi.jjakkung'
KEEP = 10
path = pathlib.Path('public/.well-known/assetlinks.json')

der = pathlib.Path(sys.argv[1]).read_bytes()
fp = ':'.join(f'{b:02X}' for b in hashlib.sha256(der).digest())

old = []
if path.exists():
    for entry in json.loads(path.read_text(encoding='utf-8')):
        target = entry.get('target', {})
        if target.get('package_name') == PACKAGE:
            old = target.get('sha256_cert_fingerprints', [])
prints = [fp] + [x for x in old if x != fp]
data = [{
    'relation': ['delegate_permission/common.handle_all_urls'],
    'target': {'namespace': 'android_app', 'package_name': PACKAGE, 'sha256_cert_fingerprints': prints[:KEEP]},
}]
path.parent.mkdir(parents=True, exist_ok=True)
path.write_text(json.dumps(data, indent=2) + '\n', encoding='utf-8')
print('fingerprint', fp)
