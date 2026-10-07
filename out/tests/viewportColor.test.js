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
const viewportModule = (0, promises_1.readFile)(path.resolve(__dirname, '../../media/viewport.js'), 'utf8').then((source) => import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`));
(0, node_test_1.default)('preset and custom colors share the chip and swatch state', async () => {
    const { createViewportController } = await viewportModule;
    const state = { color: '#ef4444' };
    const strokeColorEl = { value: '' };
    const colorChipEl = { style: { backgroundColor: '' } };
    const colorButtonEl = {
        style: {
            setProperty(name, color) {
                strict_1.default.equal(name, '--active-color');
                strict_1.default.equal(color, state.color);
            },
        },
    };
    const swatches = ['#ef4444', '#eab308'].map((color) => {
        const classes = new Set();
        const attributes = new Map();
        return {
            dataset: { color },
            classes,
            attributes,
            classList: {
                toggle(name, active) {
                    if (active)
                        classes.add(name);
                    else
                        classes.delete(name);
                },
            },
            setAttribute(name, value) {
                attributes.set(name, value);
            },
        };
    });
    const controller = createViewportController({
        state,
        strokeColorEl,
        colorChipEl,
        colorButtonEl,
        colorPaletteEl: { querySelectorAll: () => swatches },
    });
    controller.setActiveColor('#eab308');
    strict_1.default.equal(strokeColorEl.value, '#eab308');
    strict_1.default.equal(colorChipEl.style.backgroundColor, '#eab308');
    strict_1.default.equal(swatches[1].attributes.get('aria-pressed'), 'true');
    controller.setActiveColor('#123456');
    strict_1.default.equal(strokeColorEl.value, '#123456');
    strict_1.default.equal(colorChipEl.style.backgroundColor, '#123456');
    strict_1.default.ok(swatches.every((swatch) => !swatch.classes.has('is-active')));
});
//# sourceMappingURL=viewportColor.test.js.map