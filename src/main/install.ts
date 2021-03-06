/**
 * 证书安装
 * Helper 安装等
 */
//@ts-ignore
import fs from 'fs-extra-promise';
//@ts-ignore
import tempdir from 'tempdir';
import path from 'path';
//@ts-ignore
import sudo from 'sudo-prompt';
//@ts-ignore
import forge from 'node-forge';
import { execSync } from 'child_process';
import {
    CERT_KEY_FILE_NAME,
    CERT_FILE_NAME,
    LIGHTPROXY_CERT_DIR_PATH,
    LIGHTPROXY_CERT_KEY_PATH,
    SYSTEM_IS_MACOS,
    PROXY_CONF_HELPER_PATH,
    PROXY_CONF_ORIGIN_HELPER_PATH,
} from './const';

const pki = forge.pki;

const sudoOptions = {
    name: 'LightProxy',
};

async function generateCert() {
    return new Promise(resolve => {
        const keys = pki.rsa.generateKeyPair(2048);
        const cert = pki.createCertificate();
        cert.publicKey = keys.publicKey;
        cert.serialNumber = new Date().getTime() + '';
        cert.validity.notBefore = new Date();
        cert.validity.notBefore.setFullYear(cert.validity.notBefore.getFullYear() - 10);
        cert.validity.notAfter = new Date();
        cert.validity.notAfter.setFullYear(cert.validity.notAfter.getFullYear() + 10);

        const attrs = [
            {
                name: 'commonName',
                value: 'LightProxy-' + new Date().toISOString().slice(0, 10),
            },
            {
                name: 'countryName',
                value: 'CN',
            },
            {
                shortName: 'ST',
                value: 'Hangzhou',
            },
            {
                name: 'localityName',
                value: 'Hangzhou',
            },
            {
                name: 'organizationName',
                value: 'LightProxy',
            },
            {
                shortName: 'OU',
                value: 'https://github.com/alibaba/lightproxy',
            },
        ];

        cert.setSubject(attrs);
        cert.setIssuer(attrs);
        cert.setExtensions([
            {
                name: 'basicConstraints',
                critical: true,
                cA: true,
            },
            {
                name: 'keyUsage',
                critical: true,
                keyCertSign: true,
            },
            {
                name: 'subjectKeyIdentifier',
            },
        ]);
        cert.sign(keys.privateKey, forge.md.sha256.create());
        const certPem = pki.certificateToPem(cert);
        const keyPem = pki.privateKeyToPem(keys.privateKey);

        resolve({
            key: keyPem,
            cert: certPem,
        });
    });
}

async function installCert() {
    console.log('Install cert');
    const certs = (await generateCert()) as {
        key: string;
        cert: string;
    };

    const dir = await tempdir();

    // 写入证书
    await fs.mkdirp(dir);
    await fs.writeFileAsync(path.join(dir, CERT_KEY_FILE_NAME), certs.key, 'utf-8');
    await fs.writeFileAsync(path.join(dir, CERT_FILE_NAME), certs.cert, 'utf-8');

    // 信任证书
    const installPromise = new Promise((resolve, reject) => {
        if (SYSTEM_IS_MACOS) {
            sudo.exec(
                `security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain "${path.join(
                    dir,
                    CERT_FILE_NAME,
                )}"`,
                sudoOptions,
                (error, stdout) => {
                    if (error) {
                        reject(error);
                    }
                    resolve(stdout);
                },
            );
        } else {
            const command = `certutil -enterprise -f -v -AddStore "Root" "${path.join(dir, CERT_FILE_NAME)}"`;
            console.log('run command', command);
            const output = execSync(command, {
                windowsHide: true,
            });
            console.log('certutil result', output.toString());
            resolve();
        }
    });

    console.log('before install');
    await installPromise;

    console.log('after install');
    // 信任完成，把证书目录拷贝过去
    await fs.copyAsync(dir, LIGHTPROXY_CERT_DIR_PATH);
    console.log('copy cert done');
}

async function checkCertInstall() {
    // 证书文件存在我就认为证书已经正确安装了
    // TODO: 也许可以做的更精准
    const certKeyExist = await fs.existsAsync(LIGHTPROXY_CERT_KEY_PATH);
    console.log('Cert install status:', certKeyExist);
    return certKeyExist;
}

async function checkHelperInstall() {
    if (!SYSTEM_IS_MACOS) {
        return true;
    }
    if (!(await fs.existsAsync(PROXY_CONF_HELPER_PATH))) {
        return false;
    }
    const info = await fs.statAsync(PROXY_CONF_HELPER_PATH);
    if (info.uid === 0) {
        // 已经安装
        return true;
    }
    return false;
}

async function installHelper() {
    const installPromise = new Promise((resolve, reject) => {
        if (SYSTEM_IS_MACOS) {
            fs.copySync(PROXY_CONF_ORIGIN_HELPER_PATH, PROXY_CONF_HELPER_PATH);
            sudo.exec(
                `chown root:admin "${PROXY_CONF_HELPER_PATH}" && chmod a+rx+s "${PROXY_CONF_HELPER_PATH}"`,
                sudoOptions,
                (error, stdout) => {
                    if (error) {
                        reject(error);
                    }
                    resolve(stdout);
                },
            );
        }
    });

    await installPromise;
}

// 检查安装状态，如果没安装就安装一下
export default async function checkInstallStatus() {
    if (!(await checkCertInstall())) {
        await installCert();
    }

    if (!(await checkHelperInstall())) {
        await installHelper();
    }
}
