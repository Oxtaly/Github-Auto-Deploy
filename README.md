# Github Auto Deploy using a Bun serve

## Installation:
Install this using git clone, then run it using `bun index.js`
```
git clone https://github.com/Oxtaly/Github-Auto-Deploy.git
```

## Args
--quiet // sets the web server to quiet mode, disables logging every event
-h\[host\] `-h127.0.0.1` | -host=\[host\] `-host=127.0.0.1` // sets the host for the web server, overrides config.host and .env HOST, defaults to null (bun default, 0.0.0.0)
-p\[port\] `-p3000`      | -port=\[port\] `-port=3000` // sets the port for the web server, overrides config.port and .env PORT, defaults to 3000

## Configuraton:
Copy config.json.example and remove/modify it to fit your needs

## How to use:
- Install/clone this repo using the instructions above
- In your config.json, add your repository in the repositories array that looks roughly like the following:
```json
{
    // [required] url for the repo that'll update .path when a push is received
    "url": "https://github.com/MyUser/MyRepo/",
    // [required] path to the local repo that'll be updated when a push is received from the repo url above
    "path": "/path/to/the/local/repo/",
    // [optional] branch name to respond to pushes to (if ommitted, will accept any branch push) [Not recommended]
    "branch": "refs/heads/main",
    // [optional] secret used aganinst a sha-256 hash to validate the update comes from an authorized source (leave empty to accept any request) [Recommended!]
    "secret": "myVerySecretSecret",
    // [optional] bash command executed cd'ed in .path to update the local repo, default (if property absent) command below
    "update":"git fetch --all && git checkout --force \"origin/main\"",
    // [required] bash command executed after the update command to re-deploy the .path repo, example that would work for this repo using systemd on a ubuntu linux system:
    "deploy":"bun install && service github-auto-deploy restart"
}
```
- Make a webhook on your github repo, you can see how over at https://docs.github.com/en/webhooks, and put the url of this server as the webhook url
- You should now be all good to go! You can now just run the server using `bun index.js` with any arguments you want to use (see Args), or deamonize it using systemd on linux using the instructions below:

## Deamonize it:
- On linux, make a file named `github-auto-deploy.service` using the configuration below at the path `/lib/systemd/system`
```ini
# See https://bun.sh/guides/ecosystem/systemd for ref

[Unit]
# describe the app
Description=github-auto-deploy
# start the app after the network is available
After=network.target

[Service]
# usually you'll use 'simple'
# one of https://www.freedesktop.org/software/systemd/man/systemd.service.html#Type=
Type=simple
# which user to use when starting the app
User=root # Using root as an example, see https://bun.sh/guides/ecosystem/systemd on how to use another user
WorkingDirectory=/path/to/Github-Auto-Deploy # Where you installed the repo
# the command to start the app
# requires absolute paths
ExecStart=/root/.bun/bin/bun run index.js # Add any arguments you wanna use here, like --quiet or -p3000
# restart policy
# one of {no|on-success|on-failure|on-abnormal|on-watchdog|on-abort|always}
Restart=always

[Install]
# start the app automatically
WantedBy=multi-user.target
```
- Run this command to enable the deamon: `sudo systemctl enable github-auto-deploy`
- Then run this command to start it: `sudo systemctl github-auto-deploy`
