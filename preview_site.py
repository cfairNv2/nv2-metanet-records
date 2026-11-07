from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit, unquote
SITE = Path(__file__).resolve().parent / 'site'
class Handler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        path = unquote(urlsplit(path).path)
        if path.startswith('/nv2-metanet-records/'):
            path = path[len('/nv2-metanet-records/'):]
        resolved = (SITE / path.lstrip('/')).resolve()
        return str(resolved if resolved.is_relative_to(SITE) else SITE)
    def send_error(self, code, message=None, explain=None):
        if code == 404:
            data = (SITE / '404.html').read_bytes()
            self.send_response(404)
            self.send_header('Content-Type','text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        else:
            super().send_error(code, message, explain)
ThreadingHTTPServer(('127.0.0.1', 8000), Handler).serve_forever()
