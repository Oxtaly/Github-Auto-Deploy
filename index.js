// Writen in Bun version 1.1.17, run as a service on ubuntu 18

console.log(`Starting bun github auto-deploy!`)

const { exec } = require('child_process')
const { existsSync } = require('fs')
const path = require('path')

//#region Config Validation
class MalformedConfigError extends Error {}

if(!existsSync(path.join(__dirname, './config.json')))
    throw new MalformedConfigError(`Missing config file! (put config at path: "${path.join(__dirname, './config.json')}")`)

/** @type {{ port?: number, host?: string, repositories: { path: string, url: string, deploy: string, branch?: string, update?: string, secret?: string }[] }} */
const config = tryCatch(() => require(path.join(__dirname, './config.json')), (error) => {
    throw new MalformedConfigError(`Config is invalid JSON!`)
})

if(!config.repositories)
    throw new MalformedConfigError(`Missing config.repositories!`)

if(!Array.isArray(config.repositories))
    throw new MalformedConfigError(`config.repositories is not an array!`)

config.repositories.forEach((watchedRepo, i) => {
    if(typeof watchedRepo !== 'object' || Array.isArray(watchedRepo))
        throw new MalformedConfigError(`Repo is not an object! Please look at config.json.example! (config.repositories[${i}])`)
    
    if(!watchedRepo.path)
        throw new MalformedConfigError(`Missing local repo path! (config.repositories[${i}])`)
    if(typeof watchedRepo.path !== "string")
        throw new MalformedConfigError(`Path must be a string! (${watchedRepo.path}) (config.repositories[${i}])`)
    if(!existsSync(path.resolve(watchedRepo.path)))
        throw new MalformedConfigError(`Path does not exist! (${watchedRepo.path}) (config.repositories[${i}])`)
    if(!existsSync(path.join(path.resolve(watchedRepo.path), `/.git`)))
        throw new MalformedConfigError(`No github repo found at path! (${watchedRepo.path}) (config.repositories[${i}])`)

    if(!watchedRepo.url)
        throw new MalformedConfigError(`Missing repo url! (config.repositories[${i}])`)
    if(typeof watchedRepo.url !== "string")
        throw new MalformedConfigError(`Repo URL must be a string! (${watchedRepo.url}) (config.repositories[${i}])`)

    if(!watchedRepo.deploy)
        throw new MalformedConfigError(`Missing deploy command property! (config.repositories[${i}])`)
    if(typeof watchedRepo.deploy !== "string")
        throw new MalformedConfigError(`Deploy command must be a string! (${watchedRepo.deploy}) (config.repositories[${i}])`)

    if(watchedRepo.secret && typeof watchedRepo.secret !== 'string')
        throw new MalformedConfigError(`Secret must be string | null! (${watchedRepo.secret}) (config.repositories[${i}])`)

    if(watchedRepo.update && typeof watchedRepo.update !== 'string')
        throw new MalformedConfigError(`Update command must be string | null! (${watchedRepo.update}) (config.repositories[${i}])`)

    if(watchedRepo.branch && typeof watchedRepo.branch !== 'string')
        throw new MalformedConfigError(`Branch command must be string | null! (${watchedRepo.branch}) (config.repositories[${i}])`)
})
//#endregion Config Validation

const getPortFromArgvs = () => {
    const port = process?.argv?.find((arg,) => arg.startsWith(`-port=`) || arg.startsWith(`-p`))?.replace(/^(?:-port=|-p)/, '')
    if(port && isNaN(parseInt(port)))
        throw new Error(`Port must be a number or null!`)
    return port ? parseInt(port) : null
}

const getHostFromArgsv = () => {
    const host = process?.argv?.find((arg,) => arg.startsWith(`-host=`) || arg.startsWith(`-h`))?.replace(/^(?:-host=|-h)/, '')
    return host || null
}

const quiet = process?.argv?.includes('--quiet') || process?.argv?.includes('-q') || false
const port = getPortFromArgvs() ?? config.port ?? process.env.PORT ?? 3000
const host = getHostFromArgsv() ?? config.host ?? process.env.HOST ?? null

if(quiet) 
    console.log(`Set quiet mode to true!`)



/**
 * @template T
 * @template K
 * @param {() => T} callback 
 * @param {(error: Error) => K} handler
 * @returns {T | K}
 */
function tryCatch(callback, handler) {
    try {
        return callback()
    } catch (error) {
        return handler(error)
    }
}

function respondJSON(status, json) {
    return new Response(json ? JSON.stringify(json) : null, { status: status, headers: { "content-type": "application/json" } })
}

//#region Stole stright from github's example on how to verify webhook signature {@link https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries#javascript-example}
const { subtle } = require('crypto')
const encoder = new TextEncoder();

async function verifySignature(secret, header, payload) {
    let parts = header.split("=");
    let sigHex = parts[1];

    let algorithm = { name: "HMAC", hash: { name: 'SHA-256' } };

    let keyBytes = encoder.encode(secret);
    let extractable = false;
    let key = await subtle.importKey(
        "raw",
        keyBytes,
        algorithm,
        extractable,
        [ "sign", "verify" ],
    );

    let sigBytes = hexToBytes(sigHex);
    let dataBytes = encoder.encode(payload);
    let equal = await subtle.verify(
        algorithm.name,
        key,
        sigBytes,
        dataBytes,
    );

    return equal;
}

function hexToBytes(hex) {
    let len = hex.length / 2;
    let bytes = new Uint8Array(len);

    let index = 0;
    for (let i = 0; i < hex.length; i += 2) {
        let c = hex.slice(i, i + 2);
        let b = parseInt(c, 16);
        bytes[index] = b;
        index += 1;
    }

    return bytes;
}
//#endregion

Bun.serve({
    /**
     * @param {Request} req 
     * @param {*} server 
     */
    async fetch(req, server) {
        
        try {
            const reqIP = server.requestIP(req);
            const forwardedIP = req.headers.get('x-forwarded-for')
            
            if(!quiet) console.log(`[${new Date().toISOString()}] ${req.method} ${forwardedIP || reqIP.address} ${req.url}`)
        } catch (error) {
            console.error(error)
            console.log(`Error logging request!`)
        }

        if(req.method !== 'POST')
            return respondJSON(405, { error: { message: "Unhandled method!" } })

        if(req.headers.get("content-type") !== 'application/json')
            return respondJSON(415, { error: { message: "Unhandled content-type, please use application/json!" } })
        
        const event = req.headers.get('X-Github-Event')

        if(!event)
            return respondJSON(400)
        if(event === 'ping') {
            if(!quiet) console.log(`Received ping event!`)
            return respondJSON(204)
        }
        if(event !== 'push') {
            if(!quiet) console.log(`Unhandled event!`)
            return respondJSON(422, { error: { message: "Unhandled event!" } })
        }

        
        const reqBody = await tryCatch(
            async () => (await (await req.blob()).text()), 
            (error) => {
                console.error(error)
                console.log(`Error reading request body!`)
                return respondJSON(500, { error: { message: "Cannot read body!" } })
            }
        )
        if(reqBody instanceof Response) { // Not super pretty way to handle a try catch but can't be bother and already wrote the tryCatch method anyways
            if(!quiet) console.error(`Couldn't parse request body!`)
            return reqBody 
        }

        /** @type {{ ref: string, repository: { url: string } }} */
        const reqJSON = await tryCatch(
            () => JSON.parse(reqBody), 
            () => respondJSON(400, { error: { message: "Invalid JSON!" } })
        )
        if(reqJSON instanceof Response) { // Not super pretty way to handle a try catch but can't be bother and already wrote the tryCatch method anyways
            if(!quiet) console.error(`Couldn't parse json body!`)
            return reqJSON 
        }

        const possibleRepos = config.repositories.filter((watchedRepo) => watchedRepo.url === reqJSON.repository.url || watchedRepo.url === `${reqJSON.repository.url}/`)

        if(!possibleRepos.length) {
            if(!quiet) console.log(`No matching repos handled!`)
            return respondJSON(204)
        }

        const reposWithValidSignature = []
        const reposMissingSignature = []
        const reposWithoutSecrets = []
        for (let i = 0; i < possibleRepos.length; i++) {
            const watchedRepo = possibleRepos[i];
            if(!watchedRepo.secret) {
                reposWithoutSecrets.push(watchedRepo)
                continue
            }

            const signature = req.headers.get('X-Hub-Signature-256')
            if(!signature) {                    
                reposMissingSignature.push(watchedRepo);
                continue;
            }
            if((await verifySignature(watchedRepo.secret, signature, reqBody)) !== true)
                continue;
            reposWithValidSignature.push(watchedRepo)
        }

        if(possibleRepos.find((watchedRepo) => watchedRepo.secret) && !reposWithValidSignature.length && reposMissingSignature.length && !reposWithoutSecrets.length) {
            if(!quiet) console.log(`Missing required signatures on ${reposMissingSignature.length} matching repos!`)
            return respondJSON(403, { error: { message: "Missing required signature!" } })
        }
        if(possibleRepos.find((watchedRepo) => watchedRepo.secret) && !reposWithValidSignature.length  && !reposWithoutSecrets.length) {
            if(!quiet) console.log(`Invalid signatures on ${possibleRepos.filter((watchedRepo) => watchedRepo.secret).length} matching secret signed repos!`)
            return respondJSON(403, { error: { message: "Invalid signature!" } })
        }

        reposWithValidSignature.concat(reposWithoutSecrets).forEach((watchedRepo) => {
            if(watchedRepo.branch && watchedRepo.branch !== reqJSON.ref) 
                return
            const updateCommand = watchedRepo.update ? watchedRepo.update : `/usr/bin/git fetch --all && /usr/bin/git checkout --force ${watchedRepo.branch ? watchedRepo.branch : `"origin/main"`}`
            const fullUpdateCommand = `cd "${watchedRepo.path.replace(/((?:\\\\)?")/g, `\\$1`)}" && ${updateCommand}`
            if(!quiet) console.log(`Executing update command! (${fullUpdateCommand})`)
            exec(`${fullUpdateCommand}`, (error, stdout, stderr) => {
                if(error)
                    return console.error(`error`, error)
                console.log(`stderr`, stderr)
                const deployCommand = `cd "${watchedRepo.path.replace(/((?:\\\\)?")/g, `\\$1`)}" && ${watchedRepo.deploy}`
                if(!quiet) console.log(`Executing deploy command! (${deployCommand})`)
                exec(`${deployCommand}`, (error, stdout, stderr) => {
                    if(error)
                        return console.error(error)
                    if(stderr)
                        return console.log(stderr)
                })
            })
        })

        return respondJSON(204)
    },
    port: port,
    hostname: host
})

process.on('SIGINT', function() {
    console.log(`Ctrl+c captured`)
    process.exit();
});