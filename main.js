import { app, BrowserWindow, ipcMain, Menu } from "electron";
import path from "path";
import { fileURLToPath } from "url";
import fs from 'fs';
import { screen } from 'electron';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appTitle = "OpenAccount";

let selectionWindow;
let mainWindow;
let loadingWindow;
let activeWindows = new Set();

const APP_ICON_PATH = path.join(__dirname, 'public', 'icon.ico');

const CONFIG_PATH = path.join(app.getPath('userData'), 'accounts.json');

function loadAccounts() {
    try {
        if (fs.existsSync(CONFIG_PATH)) {
            const data = fs.readFileSync(CONFIG_PATH, 'utf8');
            return JSON.parse(data);
        }
    } catch (error) {
        console.error('Error loading accounts:', error);
    }
    const defaultAccounts = {
        account1: "persist:account1",
        account2: "persist:account2",
        account3: "persist:account3"
    };
    saveAccounts(defaultAccounts);
    return defaultAccounts;
}

function saveAccounts(accounts) {
    try {
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(accounts, null, 2));
    } catch (error) {
        console.error('Error saving accounts:', error);
    }
}

let accountPartitions = loadAccounts();

function setupIPCHandlers() {
    ipcMain.removeAllListeners('get-accounts');
    ipcMain.removeAllListeners('adjust-window-size');

    ipcMain.handle('get-accounts', () => {
        return Object.keys(accountPartitions);
    });

    ipcMain.on('adjust-window-size', (event, width, height) => {
        const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;

        const x = Math.round((screenWidth - width) / 2);
        const y = Math.round((screenHeight - height) / 2);

        if (selectionWindow) {
            selectionWindow.setBounds({
                x,
                y,
                width,
                height,
            });
        }
    });
}

function createSelectionWindow() {
    if (selectionWindow) {
        selectionWindow.focus();
        return;
    }

    selectionWindow = new BrowserWindow({
        width: 500,
        height: 400,
        resizable: true,
        frame: true,
        transparent: false,
        show: false,
        icon: APP_ICON_PATH,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
        },
    });

    selectionWindow.setTitle(appTitle);

    selectionWindow.webContents.on('page-title-updated', (event) => {
        event.preventDefault(); 
        selectionWindow.setTitle(appTitle);
    });

    selectionWindow.loadFile(path.join(__dirname, "public", "select.html"));

    selectionWindow.once('ready-to-show', () => {
        selectionWindow.show();
        selectionWindow.focus();
    });

    selectionWindow.on("closed", () => {
        selectionWindow = null;
    });
}

function createLoadingWindow() {
    loadingWindow = new BrowserWindow({
        width: 300,
        height: 200,
        alwaysOnTop: true,
        frame: false,
        transparent: false,
        icon: APP_ICON_PATH,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
        },
    });

    loadingWindow.loadFile(path.join(__dirname, "public", "loading.html"));

    const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
    const x = Math.round((screenWidth - 300) / 2);
    const y = Math.round((screenHeight - 200) / 2);
    loadingWindow.setBounds({ x, y, width: 300, height: 200 });
}

function updateContextMenu(window) {
    const accountSubmenu = Object.keys(accountPartitions).map(account => ({
        label: account,
        click: () => switchAccount(account)
    }));

    const contextMenu = Menu.buildFromTemplate([
        {
            label: 'ChatGPT',
            submenu: [
                {
                    label: 'Quit',
                    click: () => app.quit(),
                },
            ],
        },
        {
            label: 'Edit',
            submenu: [
                { role: 'undo' },
                { role: 'redo' },
                { type: 'separator' },
                { role: 'cut' },
                { role: 'copy' },
                { role: 'paste' },
                { role: 'selectAll' },
                { type: 'separator' },
                {
                    label: 'Return to Select',
                    click: () => returnToSelectionWindow()
                }
            ],
        },
        {
            label: 'Switch Account',
            submenu: accountSubmenu,
        },
    ]);

    window.setMenu(contextMenu);
}

function returnToSelectionWindow() {
    if (mainWindow) {
        mainWindow.removeAllListeners('closed');
        mainWindow.close();
        mainWindow = null;
    }

    createSelectionWindow();
}

function switchAccount(account) {
    createLoadingWindow();

    if (mainWindow) {
        mainWindow.removeAllListeners('closed');
        mainWindow.close();
    }

    setTimeout(() => {
        createMainWindow(account);
    }, 500);
}

function createMainWindow(account) {
    if (!accountPartitions[account]) {
        console.error(`Partition for ${account} not found.`);
        if (loadingWindow) {
            loadingWindow.close();
            loadingWindow = null;
        }
        return;
    }

    if (selectionWindow) {
        selectionWindow.close();
        selectionWindow = null;
    }

    mainWindow = new BrowserWindow({
        width: 1000,
        height: 1000,
        alwaysOnTop: true,
        resizable: true,
        frame: true,
        transparent: false,
        icon: APP_ICON_PATH,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            partition: accountPartitions[account],
        },
    });

    mainWindow.setTitle(appTitle);

    activeWindows.add(mainWindow);
    mainWindow.loadURL("https://chat.openai.com/");
    updateContextMenu(mainWindow);

    mainWindow.webContents.on('page-title-updated', (event) => {
        event.preventDefault(); 
        mainWindow.setTitle(appTitle);
    });

    const titleInterval = setInterval(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.setTitle(appTitle);
        } else {
            clearInterval(titleInterval);
        }
    }, 5000);

    mainWindow.webContents.on('did-finish-load', () => {
        if (loadingWindow) {
            loadingWindow.close();
            loadingWindow = null;
        }
    });

    mainWindow.on("closed", () => {
        activeWindows.delete(mainWindow);
        clearInterval(titleInterval);
        mainWindow = null;
    });
}


function deleteAccount(account) {
    const accountKeys = Object.keys(accountPartitions);
    if (accountKeys.length <= 1) {
        console.error('Cannot delete the last account');
        return false;
    }

    delete accountPartitions[account];
    
    saveAccounts(accountPartitions);
    
    return true;
}

function registerGlobalIPCHandlers() {
    ipcMain.on('add-account', (event, accountName) => {
        if (!accountPartitions[accountName]) {
            accountPartitions[accountName] = `persist:${accountName}`;
            saveAccounts(accountPartitions);
            event.reply('accounts-updated', Object.keys(accountPartitions));
        }
    });

    ipcMain.on("select-account", (event, accountName) => {
        console.log(`Account selected: ${accountName}`);
        
        if (selectionWindow) {
            selectionWindow.close();
            selectionWindow = null;
        }
        
        createLoadingWindow();
        
        setTimeout(() => {
            createMainWindow(accountName);
        }, 500);
    });

    ipcMain.on('delete-account', (event, accountName) => {
        const success = deleteAccount(accountName);
        if (success) {
            event.reply('accounts-updated', Object.keys(accountPartitions));
        } else {
            event.reply('delete-account-error', 'Cannot delete the last account');
        }
    });
}

app.whenReady().then(() => {
    setupIPCHandlers();
    registerGlobalIPCHandlers();
    
    createSelectionWindow();

    app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) createSelectionWindow();
    });
});

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
});