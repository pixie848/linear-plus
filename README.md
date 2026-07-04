# auto linear key

Automates the tedious part of getting the loader from `launcher.linear.pub`:
it reads your **current** key from `keys.txt`, opens the site, enters the key,
clicks through, and **saves the downloaded loader** into the `downloads/` folder.

After downloading, it launches the downloaded `.exe` automatically.

## Setup and run

Double-click `Get Loader.bat`.

Normal launches use quick Node.js, `node_modules`, and browser-cache checks,
then start the loader immediately. If setup files are missing, it installs only
the missing pieces before the loader starts.

## Add your key

Open `keys.txt` and put exactly one line in it: your real 50-character
letters/numbers key. No leading `*` is needed.

Do not add comments, examples, or extra old keys.

If `keys.txt` is empty or missing, the script asks for your key once, saves it
as the current key, and then future runs are automatic. Invalid text is
rejected until a real 50-character key is entered.

After the key is ready, the first run asks for spoofer type: press `B` for BE
or `N` for none. Later runs show both the saved spoofer and the live spoofer
being downloaded. Press `S` any time after those lines appear to edit the saved
spoofer, then press `B` or `N`. When the saved spoofer is BE, BE is only used
once per Windows boot; later runs in the same boot use none temporarily, and the
next restart enables BE once again.

You can also run:

```
node get-loader.js
```

or pass the same 50-character key directly on the command line.

When it finishes, it launches the downloaded `.exe` automatically.

## Uninstall

Double-click `Uninstall Linear Loader.bat`.
It instantly removes old Startup warmup entries, downloaded loaders, saved
setup files, your saved key, and this folder.
