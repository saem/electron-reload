import { app, BrowserWindow } from 'electron'
import chokidar from 'chokidar'
import fs from 'fs'
import { spawn } from 'child_process'

const appPath = app.getAppPath()
const ignoredPaths = /node_modules|[/\\]\./
// Main file poses a special case, as its changes are
// only effective when the process is restarted (hard reset)
// We assume that electron-reload is required by the main
// file of the electron application
if (module.parent == null) {
  throw new Error('No parent module found, ensure electron-reload required in the main electron module.')
}
const mainFile = module.parent.filename

type HardResetMethod = 'exit' | 'quit';
type ResetHandler = () => void;

/**
 * Creates a callback for hard resets.
 *
 * @param {String} eXecutable path to electron executable
 * @param {String} hardResetMethod method to restart electron
 * @param {String} argv arguments to be passed to the newly spawned process
 *
 * @returns {Function} handler to pass to chokidar
 */
const createHardresetHandler = (
  eXecutable: string,
  hardResetMethod: HardResetMethod = 'quit',
  argv: string[] = []
): ResetHandler =>
  () => {
    // Detaching child is useful when in Windows to let child
    // live after the parent is killed
    const args = (argv || []).concat([appPath])
    const child = spawn(eXecutable, args, {
      detached: true,
      stdio: 'inherit'
    })
    child.unref()
    // Kamikaze!

    // In cases where an app overrides the default closing or quiting actions
    // firing an `app.quit()` may not actually quit the app. In these cases
    // you can use `app.exit()` to gracefully close the app.
    if (hardResetMethod === 'exit') {
      app.exit()
    } else {
      app.quit()
    }
  }

export interface ReloadOptions {
  electron?: string;
  hardResetMethod?: HardResetMethod;
  forceHardReset?: boolean;
  argv?: string[]
}

export default (glob: string | string[], options: ReloadOptions = {}) => {
  const browserWindows: BrowserWindow[] = []
  const watcher = chokidar.watch(
    glob,
    Object.assign({ ignored: [ignoredPaths, mainFile] }, options)
  )

  // soft reset: used to reload browser windows
  const softResetHandler = () => browserWindows.forEach(
    bw => bw.webContents.reloadIgnoringCache()
  )

  // Add each created BrowserWindow to list of maintained items
  app.on('browser-window-created', (_, bw) => {
    browserWindows.push(bw)

    // Remove closed windows from list of maintained items
    bw.on('closed', function () {
      const i = browserWindows.indexOf(bw) // Must use current index
      browserWindows.splice(i, 1)
    })
  })

  // Enable default soft reset
  watcher.on('change', softResetHandler)

  // Preparing hard reset if electron executable is given in options
  // A hard reset is only done when the main file has changed
  const eXecutable = options.electron
  if (eXecutable && fs.existsSync(eXecutable)) {
    // hard reset: restart the whole electron process
    const hardResetHandler = createHardresetHandler(eXecutable, options.hardResetMethod, options.argv)
    const hardWatcher = chokidar.watch(mainFile, Object.assign({ ignored: [ignoredPaths] }, options))

    if (options.forceHardReset === true) {
      // Watch every file for hard reset and not only the main file
      hardWatcher.add(glob)
      // Stop our default soft reset
      watcher.close()
    }

    hardWatcher.once('change', hardResetHandler)
  } else {
    console.log('Electron could not be found. No hard resets for you!')
  }
}
