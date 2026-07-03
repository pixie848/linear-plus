# auto linear key

Automates the tedious part of getting the loader from `launcher.linear.pub`:
it reads your **current** key from `keys.txt`, opens the site, enters the key,
clicks through, and **saves the downloaded loader** into the `downloads/` folder.

After downloading, it launches the downloaded `.exe` automatically.

## Setup and run

Double-click `Get Loader.bat`.

On the first run it checks Node.js, `node_modules`, and Playwright Chromium.
Anything already installed is skipped, and anything missing is installed before
the loader starts.

## Add your key

Open `keys.txt` and put exactly one line in it: `*` followed immediately by
your real 50-character letters/numbers key.

Do not add comments, examples, or extra old keys.

If `keys.txt` is empty or missing, the script asks for your key once, saves it
as the current `*` key, and then future runs are automatic. Invalid text is
rejected until a real 50-character key is entered.


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
