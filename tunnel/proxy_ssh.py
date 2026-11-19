import sys, os, socket, base64, urllib.parse, select
host, port = sys.argv[1], int(sys.argv[2])
proxy_url = os.environ.get('https_proxy') or os.environ.get('HTTPS_PROXY') or os.environ.get('http_proxy')
u = urllib.parse.urlparse(proxy_url)
ph, pp = u.hostname, u.port or 3128
auth = base64.b64encode(f"{urllib.parse.unquote(u.username or '')}:{urllib.parse.unquote(u.password or '')}".encode()).decode()
s = socket.create_connection((ph, pp), timeout=15)
s.sendall(f"CONNECT {host}:{port} HTTP/1.1\r\nHost: {host}:{port}\r\nProxy-Authorization: Basic {auth}\r\n\r\n".encode())
resp = b""
while b"\r\n\r\n" not in resp:
    chunk = s.recv(4096)
    if not chunk:
        sys.exit(1)
    resp += chunk
if b" 200 " not in resp.split(b"\r\n")[0]:
    sys.exit(1)
s.setblocking(False)
in_fd, out_fd = 0, 1
# set stdin/stdout nonblocking via os.set_blocking
os.set_blocking(0, False)
os.set_blocking(1, False)
stdin_open, sock_open = True, True
while stdin_open or sock_open:
    r, _, _ = select.select([0, s] if stdin_open and sock_open else ([0] if stdin_open else [s]), [], [], 30)
    if not r:
        break
    if 0 in r and stdin_open:
        try:
            data = os.read(0, 65536)
        except BlockingIOError:
            data = None
        if data:
            try:
                s.sendall(data)
            except Exception:
                break
        elif data == b"":
            stdin_open = False
            try:
                s.shutdown(socket.SHUT_WR)
            except Exception:
                pass
    if s in r and sock_open:
        try:
            data = s.recv(65536)
        except BlockingIOError:
            data = None
        if data:
            # write all to stdout fd 1
            view = memoryview(data)
            while view:
                try:
                    n = os.write(1, view)
                    view = view[n:]
                except BlockingIOError:
                    select.select([], [1], [], 5)
        elif data == b"":
            sock_open = False
            break
