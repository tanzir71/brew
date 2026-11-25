import net from 'node:net';
import tls from 'node:tls';
import { readFileSync } from 'node:fs';

// The existing explicitly public localhost-only test certificate/key are reused.
const cert = readFileSync(new URL('./fixtures/imap-cert.pem', import.meta.url));
const key = readFileSync(new URL('./fixtures/imap-key.pem', import.meta.url));

export async function smtpServer(options: {
  security: 'tls' | 'starttls';
  reject?: boolean;
  noStarttls?: boolean;
}) {
  const messages: string[] = [];
  const recipients: string[] = [];
  const auth: Array<{ encrypted: boolean; value: string }> = [];
  const sockets = new Set<net.Socket>();
  const attach = (initial: net.Socket, encrypted: boolean, greet = true) => {
    let socket = initial;
    let buffer = '';
    let data: string[] | null = null;
    const track = (value: net.Socket) => {
      sockets.add(value);
      value.on('error', () => {});
      value.on('close', () => sockets.delete(value));
    };
    track(socket);
    const consume = (bytes: Buffer) => {
      buffer += bytes.toString('utf8');
      for (;;) {
        const newline = buffer.indexOf('\r\n');
        if (newline < 0) break;
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 2);
        if (data) {
          if (line === '.') {
            messages.push(data.join('\r\n'));
            data = null;
            socket.write('250 queued\r\n');
          } else data.push(line.startsWith('..') ? line.slice(1) : line);
          continue;
        }
        if (/^EHLO|^HELO/i.test(line))
          socket.write(
            `250-localhost\r\n${!encrypted && !options.noStarttls ? '250-STARTTLS\r\n' : ''}250-AUTH PLAIN\r\n250 SIZE 10000000\r\n`,
          );
        else if (/^STARTTLS$/i.test(line)) {
          if (options.noStarttls) {
            socket.write('454 TLS unavailable\r\n');
            continue;
          }
          socket.write('220 Ready for TLS\r\n');
          socket.removeListener('data', consume);
          const secure = new tls.TLSSocket(socket, {
            isServer: true,
            secureContext: tls.createSecureContext({ cert, key }),
          });
          socket = secure;
          attach(secure, true, false);
          return;
        } else if (/^AUTH /i.test(line)) {
          auth.push({
            encrypted,
            value: Buffer.from(line.split(' ')[2] ?? '', 'base64').toString(),
          });
          socket.write(encrypted ? '235 Authenticated\r\n' : '530 TLS required\r\n');
        } else if (/^MAIL FROM:/i.test(line)) socket.write('250 Sender OK\r\n');
        else if (/^RCPT TO:/i.test(line)) {
          recipients.push(line);
          socket.write(
            options.reject
              ? '550 server-private-detail recipient rejected\r\n'
              : '250 Recipient OK\r\n',
          );
        } else if (/^DATA$/i.test(line)) {
          data = [];
          socket.write('354 End with dot\r\n');
        } else if (/^QUIT$/i.test(line)) socket.end('221 Bye\r\n');
        else if (/^RSET|^NOOP/i.test(line)) socket.write('250 OK\r\n');
        else socket.write('502 Unsupported\r\n');
      }
    };
    socket.on('data', consume);
    if (greet) socket.write('220 localhost test SMTP\r\n');
  };
  const server =
    options.security === 'tls'
      ? tls.createServer({ cert, key }, (socket) => attach(socket, true))
      : net.createServer((socket) => attach(socket, false));
  server.on('tlsClientError', () => {});
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as net.AddressInfo).port;
  return {
    port,
    ca: cert,
    messages,
    recipients,
    auth,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
