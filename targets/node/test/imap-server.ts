import { createServer, type TLSSocket } from 'node:tls';
import fs from 'node:fs';
import type { AddressInfo } from 'node:net';

/** Local protocol fixture. Its checked-in certificate/key are test-only public data. */
export async function imapServer(messages: Map<number, string>, validity = 7) {
  const cert = fs.readFileSync(new URL('./fixtures/imap-cert.pem', import.meta.url));
  const key = fs.readFileSync(new URL('./fixtures/imap-key.pem', import.meta.url));
  const commands: string[] = [];
  const sockets = new Set<TLSSocket>();
  const server = createServer({ cert, key }, (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => undefined);
    socket.setEncoding('utf8');
    socket.write('* OK Local Brew IMAP fixture\r\n');
    let pending = '';
    socket.on('data', (chunk: string) => {
      pending += chunk;
      while (pending.includes('\r\n')) {
        const index = pending.indexOf('\r\n');
        const line = pending.slice(0, index);
        pending = pending.slice(index + 2);
        const [tag, verb] = line.split(' ');
        commands.push(verb?.toUpperCase() === 'LOGIN' ? `${tag} LOGIN [test credentials]` : line);
        const ok = () => socket.write(`${tag} OK completed\r\n`);
        if (verb === 'CAPABILITY') {
          socket.write('* CAPABILITY IMAP4rev1 UIDPLUS\r\n');
          ok();
        } else if (verb === 'LOGIN' || verb === 'NOOP') ok();
        else if (verb === 'LIST' || verb === 'LSUB') {
          socket.write('* LIST () "/" "INBOX"\r\n');
          ok();
        } else if (verb === 'SELECT' || verb === 'EXAMINE') {
          socket.write(
            `* FLAGS (\\Seen \\Flagged)\r\n* ${messages.size} EXISTS\r\n* OK [UIDVALIDITY ${validity}] stable\r\n* OK [UIDNEXT ${Math.max(0, ...messages.keys()) + 1}] next\r\n`,
          );
          socket.write(`${tag} OK [READ-ONLY] selected\r\n`);
        } else if (verb === 'UID' && / UID SEARCH /i.test(line)) {
          const range = line.match(/\bUID\s+(\d+):(\d+)/i);
          const min = Number(range?.[1] ?? 1);
          const max = Number(range?.[2] ?? 4_294_967_295);
          socket.write(
            `* SEARCH ${[...messages.keys()].filter((uid) => uid >= min && uid <= max).join(' ')}\r\n`,
          );
          ok();
        } else if (verb === 'UID' && / UID FETCH /i.test(line)) {
          const uid = Number(line.match(/UID FETCH (\d+)/i)?.[1]);
          const source = messages.get(uid);
          if (source !== undefined) {
            const sequence = [...messages.keys()].sort((a, b) => a - b).indexOf(uid) + 1;
            const bytes = Buffer.from(source);
            if (/BODY\.PEEK/i.test(line)) {
              socket.write(`* ${sequence} FETCH (UID ${uid} BODY[]<0> {${bytes.length}}\r\n`);
              socket.write(bytes);
              socket.write(')\r\n');
            } else socket.write(`* ${sequence} FETCH (UID ${uid} RFC822.SIZE ${bytes.length})\r\n`);
          }
          ok();
        } else if (verb === 'LOGOUT') {
          socket.write(`* BYE closing\r\n${tag} OK logout\r\n`);
          socket.end();
        } else socket.write(`${tag} BAD unsupported fixture command\r\n`);
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    port: (server.address() as AddressInfo).port,
    cert,
    commands,
    close: () =>
      new Promise<void>((resolve, reject) => {
        for (const socket of sockets) socket.destroy();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
