"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const promises_1 = require("node:fs/promises");
const path = __importStar(require("node:path"));
const controllerModule = (0, promises_1.readFile)(path.resolve(__dirname, '../../media/toolbarVisibility.js'), 'utf8').then((source) => import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`));
class FakeElement extends EventTarget {
    hidden = false;
    inert = false;
    title = '';
    innerHTML = '';
    hovered = false;
    focusVisible = false;
    attributes = new Map();
    classes = new Set();
    classList = {
        toggle: (name, enabled) => {
            if (enabled)
                this.classes.add(name);
            else
                this.classes.delete(name);
        },
    };
    setAttribute(name, value) {
        this.attributes.set(name, value);
    }
    matches(selector) {
        return selector === ':hover' ? this.hovered : this.focusVisible;
    }
    contains(element) {
        return element === this;
    }
    focus() {
        this.focusVisible = true;
    }
    blur() {
        this.focusVisible = false;
    }
}
async function fixture() {
    const { createToolbarVisibilityController } = await controllerModule;
    const appEl = new FakeElement();
    const toolbarEl = new FakeElement();
    const revealEl = new FakeElement();
    revealEl.hidden = true;
    const pinButtonEl = new FakeElement();
    const documentEl = {
        activeElement: null,
    };
    const timers = new Map();
    let nextTimer = 0;
    let layoutChanges = 0;
    let popupOpen = false;
    const controller = createToolbarVisibilityController({
        appEl,
        toolbarEl,
        revealEl,
        pinButtonEl,
        icons: { pin: 'pin', pinOff: 'pin-off' },
        isPopupOpen: () => popupOpen,
        onLayoutChange: () => layoutChanges++,
        documentEl,
        setTimer: (callback) => {
            const id = ++nextTimer;
            timers.set(id, callback);
            return id;
        },
        clearTimer: (id) => timers.delete(id),
    });
    const tick = () => {
        const pending = [...timers.values()];
        timers.clear();
        for (const callback of pending)
            callback();
    };
    return {
        appEl,
        toolbarEl,
        revealEl,
        pinButtonEl,
        documentEl,
        controller,
        tick,
        get layoutChanges() {
            return layoutChanges;
        },
        set popupOpen(value) {
            popupOpen = value;
        },
    };
}
(0, node_test_1.default)('toolbar is pinned by default and only pin changes request layout', async () => {
    const view = await fixture();
    view.tick();
    strict_1.default.equal(view.revealEl.hidden, true);
    strict_1.default.equal(view.toolbarEl.inert, false);
    strict_1.default.equal(view.layoutChanges, 0);
    view.pinButtonEl.dispatchEvent(new Event('click'));
    strict_1.default.equal(view.pinButtonEl.attributes.get('aria-pressed'), 'false');
    strict_1.default.equal(view.appEl.classes.has('is-toolbar-unpinned'), true);
    strict_1.default.equal(view.layoutChanges, 1);
    view.tick();
    strict_1.default.equal(view.toolbarEl.inert, true);
    strict_1.default.equal(view.revealEl.hidden, false);
    strict_1.default.equal(view.layoutChanges, 1);
    view.pinButtonEl.dispatchEvent(new Event('click'));
    strict_1.default.equal(view.pinButtonEl.attributes.get('aria-pressed'), 'true');
    strict_1.default.equal(view.toolbarEl.inert, false);
    strict_1.default.equal(view.revealEl.hidden, true);
    strict_1.default.equal(view.layoutChanges, 2);
});
(0, node_test_1.default)('top edge and keyboard reveal toolbar; popups defer hiding', async () => {
    const view = await fixture();
    view.controller.setPinned(false);
    view.tick();
    view.revealEl.dispatchEvent(new Event('pointerenter'));
    strict_1.default.equal(view.toolbarEl.inert, false);
    strict_1.default.equal(view.revealEl.hidden, true);
    view.popupOpen = true;
    view.tick();
    strict_1.default.equal(view.toolbarEl.inert, false);
    view.popupOpen = false;
    view.tick();
    strict_1.default.equal(view.toolbarEl.inert, true);
    view.revealEl.dispatchEvent(new Event('focus'));
    strict_1.default.equal(view.toolbarEl.inert, false);
    strict_1.default.equal(view.pinButtonEl.focusVisible, true);
});
//# sourceMappingURL=toolbarVisibility.test.js.map