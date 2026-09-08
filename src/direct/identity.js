import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, readFile, writeFile, rename, chmod, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID, X509Certificate, createPrivateKey, createPublicKey, createHash } from 'node:crypto'
import { createSecureContext } from 'node:tls'
import { isIP } from 'node:net'
const exec = promisify(execFile)
export function certificateIdentity(cert, key) {
  const parsed = new X509Certificate(cert)
  if (key && !parsed.checkPrivateKey(createPrivateKey(key))) throw Error('certificate-key-mismatch')
  if (Date.parse(parsed.validTo) <= Date.now() || Date.parse(parsed.validFrom) > Date.now()) throw Error('certificate-expired-or-not-yet-valid')
  createSecureContext({ cert, key })
  return { pin: createHash('sha256').update(parsed.publicKey.export({type:'spki',format:'der'})).digest('base64'), expiresAt: Date.parse(parsed.validTo) }
}
export async function directCertificate(directory, hostId, address, { install = true } = {}) {
  if (!/^[a-f0-9-]{36}$/.test(hostId) || !isIP(address)) throw Error('invalid-direct-identity')
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const keyPath = join(directory, 'identity-key.pem')
  let key
  try { key = await readFile(keyPath) } catch (e) {
    if (e.code !== 'ENOENT') throw e
    const generated = await exec('openssl',['genpkey','-algorithm','RSA','-pkeyopt','rsa_keygen_bits:2048'],{ timeout:30000, maxBuffer:64*1024 })
    key = Buffer.from(generated.stdout); await writeFile(keyPath,key,{mode:0o600,flag:'wx'})
  }
  // Validate retained key before using it. Certificates rotate; this identity key does not.
  createPublicKey(createPrivateKey(key))
  const serial = randomUUID(), configPath = join(directory, `${serial}.cnf`), certPath = join(directory, `${serial}.pem`)
  const config = `[req]\nprompt=no\ndistinguished_name=dn\nx509_extensions=v3\n[dn]\nCN=Harness-${hostId}\n[v3]\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=IP:${address}\nsubjectKeyIdentifier=hash\n`
  try {
    await writeFile(configPath,config,{mode:0o600})
    await exec('openssl',['req','-new','-x509','-key',keyPath,'-out',certPath,'-days','365','-sha256','-config',configPath],{timeout:30000,maxBuffer:64*1024})
    await chmod(certPath,0o600)
    const cert = await readFile(certPath), identity = certificateIdentity(cert,key)
    const installed = join(directory,'certificate.pem')
    if (install) await rename(certPath,installed)
    return { certPath:installed, keyPath, cert, key, ...identity }
  } finally { await rm(configPath,{force:true}); await rm(certPath,{force:true}) }
}

export async function installCertificate(identity) {
  const temporary = `${identity.certPath}.${randomUUID()}.tmp`
  try { await writeFile(temporary,identity.cert,{mode:0o600,flag:'wx'}); await rename(temporary,identity.certPath) }
  finally { await rm(temporary,{force:true}) }
}
