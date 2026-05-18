import struct, urllib.request, uuid, hashlib, base64, secrets

# Generate a PKCE code_verifier and code_challenge ourselves
# Then initiate the auth flow and exchange it
code_verifier = secrets.token_urlsafe(32)
code_challenge = base64.urlsafe_b64encode(
    hashlib.sha256(code_verifier.encode()).digest()
).rstrip(b'=').decode()

state = str(uuid.uuid4())

print("=== PKCE Auth Flow ===")
print(f"code_verifier: {code_verifier}")
print(f"code_challenge: {code_challenge}")
print(f"state: {state}")
print()
print("Open this URL in your browser (while logged in to Devin):")
print(f"https://app.devin.ai/auth/cli/continue?state={state}&prompt=select_account&code_challenge={code_challenge}&code_challenge_method=S256")
print()
print("After authorizing, you'll be redirected to a page with a token/code.")
print("Paste that token/code below.")
print()

code = input("Paste the token/code: ").strip()

BASE = "https://server.codeium.com"

def varint(v):
    b = []
    while v > 0x7f:
        b.append((v & 0x7f) | 0x80)
        v >>= 7
    b.append(v)
    return bytes(b)

def field_string(no, s):
    s = s.encode('utf-8') if isinstance(s, str) else s
    return varint((no << 3) | 2) + varint(len(s)) + s

def field_message(no, msg):
    return varint((no << 3) | 2) + varint(len(msg)) + msg

def send(path, body, label):
    url = f"{BASE}/{path}"
    req = urllib.request.Request(url, data=body, headers={
        "Content-Type": "application/proto",
        "Connect-Protocol-Version": "1",
    }, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = resp.read()
            print(f"[{label}] 200 hex={data.hex()}")
            pos = 0
            while pos < len(data):
                try:
                    tag = 0; shift = 0
                    while pos < len(data):
                        b = data[pos]; pos += 1
                        tag |= (b & 0x7f) << shift; shift += 7
                        if not (b & 0x80): break
                    fn = tag >> 3; wt = tag & 0x7
                    if wt == 2:
                        l = 0; shift = 0
                        while pos < len(data):
                            b = data[pos]; pos += 1
                            l |= (b & 0x7f) << shift; shift += 7
                            if not (b & 0x80): break
                        val = data[pos:pos+l]; pos += l
                        try:
                            t = val.decode('utf-8')
                            if all(32 <= ord(c) < 127 for c in t):
                                print(f"  f{fn}: {repr(t[:300])}")
                        except: pass
                    elif wt == 0:
                        v = 0; shift = 0
                        while pos < len(data):
                            b = data[pos]; pos += 1
                            v |= (b & 0x7f) << shift; shift += 7
                            if not (b & 0x80): break
                        print(f"  f{fn}(int): {v}")
                    else: break
                except: break
    except urllib.error.HTTPError as e:
        data = e.read()
        print(f"[{label}] {e.code}: {data[:300].decode('utf-8', errors='replace')}")

# Exchange with code_verifier — try different field combinations
print("\n=== Exchanging code with verifier ===")

# field1=code, field2=code_verifier
send("exa.seat_management_pb.SeatManagementService/ExchangePKCEAuthorizationCode",
     field_string(1, code) + field_string(2, code_verifier), "code+verifier f1+f2")

send("exa.seat_management_pb.SeatManagementService/ExchangePKCEAuthorizationCode",
     field_string(2, code) + field_string(3, code_verifier), "code+verifier f2+f3")

send("exa.seat_management_pb.SeatManagementService/ExchangePKCEAuthorizationCode",
     field_string(1, code_verifier) + field_string(2, code), "verifier+code f1+f2")
