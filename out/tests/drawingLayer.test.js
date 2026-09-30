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
const drawingModule = (0, promises_1.readFile)(path.resolve(__dirname, '../../media/drawingLayer.js'), 'utf8').then((source) => import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`));
class Canvas extends EventTarget {
    width = 100;
    height = 100;
    clears = 0;
    paths = [];
    currentPath = [];
    context = {
        clearRect: () => {
            this.clears++;
        },
        beginPath: () => {
            this.currentPath = [];
        },
        moveTo: (x, y) => this.currentPath.push({ x, y }),
        lineTo: (x, y) => this.currentPath.push({ x, y }),
        stroke: () => this.paths.push([...this.currentPath]),
    };
    getContext() {
        return this.context;
    }
    getBoundingClientRect() {
        return { left: 0, top: 0, width: 100, height: 100 };
    }
    setPointerCapture() { }
}
async function fixture(t) {
    const { createDrawingLayer } = await drawingModule;
    const originalRequest = globalThis.requestAnimationFrame;
    const originalCancel = globalThis.cancelAnimationFrame;
    const frames = new Map();
    let id = 0;
    globalThis.requestAnimationFrame = (callback) => {
        frames.set(id, callback);
        return id++;
    };
    globalThis.cancelAnimationFrame = (frame) => {
        frames.delete(frame);
    };
    const pages = [1, 2].map((pageNumber) => ({
        pageNumber,
        drawingCanvas: new Canvas(),
        pageShell: new EventTarget(),
    }));
    const changes = [];
    const erased = [];
    const settings = { mode: 'annotate', allowFinger: false };
    const scroll = { scrollLeft: 0, scrollTop: 0 };
    const controller = createDrawingLayer(pages, {
        getMode: () => settings.mode,
        getAllowFingerDrawing: () => settings.allowFinger,
        getColor: () => '#123456',
        getWidth: () => 3,
        getScrollContainer: () => scroll,
        onChange: (strokes, stroke) => {
            changes.push({ strokes, stroke });
            controller.load(strokes, stroke.page); // Match the synchronous application callback.
        },
        onErase: (stroke, strokes) => {
            erased.push(stroke);
            controller.load(strokes, stroke.page);
        },
    });
    t.after(() => {
        controller.dispose();
        globalThis.requestAnimationFrame = originalRequest;
        globalThis.cancelAnimationFrame = originalCancel;
    });
    const fire = (type, props = {}, target = pages[0].drawingCanvas) => {
        const event = new Event(type, { cancelable: true });
        for (const [key, value] of Object.entries({
            pointerId: 1,
            pointerType: 'pen',
            button: 0,
            buttons: 1,
            clientX: 10,
            clientY: 10,
            ...props,
        }))
            Object.defineProperty(event, key, { value });
        target.dispatchEvent(event);
    };
    const tick = () => {
        const callbacks = [...frames.values()];
        frames.clear();
        for (const callback of callbacks)
            callback(0);
    };
    return {
        controller,
        pages,
        frames,
        fire,
        tick,
        changes,
        erased,
        settings,
        scroll,
    };
}
(0, node_test_1.default)('pointer bursts render every sample once per frame and simplify the saved stroke', async (t) => {
    const f = await fixture(t);
    f.fire('pointerdown');
    for (let i = 1; i <= 60; i++)
        f.fire('pointermove', { clientX: 10 + i });
    strict_1.default.equal(f.frames.size, 1);
    strict_1.default.equal(f.pages[0].drawingCanvas.clears, 0);
    f.tick();
    strict_1.default.equal(f.pages[0].drawingCanvas.clears, 0);
    strict_1.default.equal(f.pages[1].drawingCanvas.clears, 0);
    strict_1.default.equal(f.pages[0].drawingCanvas.paths.at(-1)?.length, 61);
    f.fire('pointermove', { clientX: 71 });
    strict_1.default.equal(f.frames.size, 1);
    f.tick();
    strict_1.default.equal(f.pages[0].drawingCanvas.clears, 0);
    strict_1.default.equal(f.pages[0].drawingCanvas.paths.at(-1)?.length, 3);
    f.fire('pointerup', { clientX: 71 });
    strict_1.default.equal(f.changes.length, 1);
    strict_1.default.deepEqual(f.changes[0].stroke.points, [
        { x: 10, y: 10 },
        { x: 71, y: 10 },
    ]);
});
(0, node_test_1.default)('release before a frame commits all samples and the final endpoint exactly once', async (t) => {
    const f = await fixture(t);
    f.fire('pointerdown');
    f.fire('pointermove', { clientX: 15 });
    f.fire('pointerup', { clientX: 20 });
    f.fire('lostpointercapture');
    strict_1.default.equal(f.frames.size, 0);
    strict_1.default.equal(f.changes.length, 1);
    strict_1.default.deepEqual(f.changes[0].stroke.points, [
        { x: 10, y: 10 },
        { x: 20, y: 10 },
    ]);
    strict_1.default.equal(f.changes[0].stroke.color, '#123456');
    strict_1.default.equal(f.changes[0].stroke.width, 3);
    const paints = f.pages[0].drawingCanvas.paths.length;
    f.tick();
    strict_1.default.equal(f.pages[0].drawingCanvas.paths.length, paints);
});
(0, node_test_1.default)('coalesced pen samples are retained and empty coalesced lists fall back to the event', async (t) => {
    const f = await fixture(t);
    f.fire('pointerdown');
    f.fire('pointermove', {
        clientX: 14,
        getCoalescedEvents: () => [
            { clientX: 12, clientY: 11 },
            { clientX: 14, clientY: 12 },
        ],
    });
    f.fire('pointermove', { clientX: 16, getCoalescedEvents: () => [] });
    f.fire('pointerup', { clientX: 16 });
    const expected = [
        { x: 10, y: 10 },
        { x: 12, y: 11 },
        { x: 14, y: 12 },
        { x: 16, y: 10 },
    ];
    const saved = f.changes[0].stroke.points;
    strict_1.default.equal(saved.length, 3);
    [expected[0], expected[2], expected[3]].forEach((point, index) => {
        strict_1.default.ok(Math.abs(saved[index].x - point.x) < 1e-9);
        strict_1.default.ok(Math.abs(saved[index].y - point.y) < 1e-9);
    });
});
for (const type of ['pointercancel', 'lostpointercapture']) {
    (0, node_test_1.default)(`${type} commits collected points without adding cancellation coordinates`, async (t) => {
        const f = await fixture(t);
        f.fire('pointerdown');
        f.fire('pointermove', { clientX: 15 });
        f.fire(type, { clientX: 0, clientY: 0 });
        strict_1.default.equal(f.frames.size, 0);
        strict_1.default.deepEqual(f.changes[0].stroke.points.at(-1), { x: 15, y: 10 });
        f.fire('pointerdown');
        f.fire('pointerup');
        strict_1.default.equal(f.changes.length, 1, 'a stationary tap remains unsaved');
    });
}
(0, node_test_1.default)('finger scroll policy and an unrelated pointer do not interrupt a pen stroke', async (t) => {
    const f = await fixture(t);
    f.fire('pointerdown', { pointerType: 'touch' });
    f.fire('pointermove', { pointerType: 'touch', clientX: 20, clientY: 30 });
    f.fire('pointerup', { pointerType: 'touch' });
    strict_1.default.deepEqual(f.scroll, { scrollLeft: -10, scrollTop: -20 });
    strict_1.default.equal(f.frames.size, 0);
    f.fire('pointerdown');
    f.fire('pointerdown', { pointerId: 2, pointerType: 'touch' });
    f.fire('pointermove', { pointerId: 2, clientX: 99 });
    f.fire('pointerup', { pointerId: 2 });
    f.fire('pointermove', { clientX: 15 });
    f.fire('pointerup', { clientX: 15 });
    strict_1.default.equal(f.changes[0].stroke.points.length, 2);
    f.settings.allowFinger = true;
    f.fire('pointerdown', { pointerType: 'touch' });
    f.fire('pointermove', { pointerType: 'touch', clientX: 20 });
    f.fire('pointerup', { pointerType: 'touch', clientX: 20 });
    strict_1.default.equal(f.changes.length, 2);
});
(0, node_test_1.default)('reload/undo/redo state cancels queued preview and restores the supplied ink', async (t) => {
    const f = await fixture(t);
    f.fire('pointerdown');
    f.fire('pointermove', { clientX: 20 });
    f.fire('pointerup', { clientX: 20 });
    const saved = f.changes[0].strokes;
    f.fire('pointerdown');
    f.fire('pointermove', { clientX: 25 });
    f.controller.load([]);
    strict_1.default.equal(f.frames.size, 0);
    f.tick();
    f.controller.load(saved);
    strict_1.default.deepEqual(f.pages[0].drawingCanvas.paths.at(-1), saved[0].points);
    f.fire('pointerup');
    strict_1.default.equal(f.changes.length, 1);
});
(0, node_test_1.default)('erase stays synchronous and cancels a queued preview through the application reload', async (t) => {
    const f = await fixture(t);
    f.fire('pointerdown');
    f.fire('pointermove', { clientX: 20 });
    f.fire('pointerup', { clientX: 20 });
    f.settings.mode = 'erase';
    f.fire('pointerdown', { clientX: 15 });
    strict_1.default.equal(f.erased.length, 1);
    strict_1.default.equal(f.frames.size, 0);
    f.settings.mode = 'annotate';
    f.controller.load(f.changes[0].strokes);
    f.fire('pointerdown', { button: 5, buttons: 32 }, f.pages[0].pageShell);
    strict_1.default.equal(f.erased.length, 2, 'stylus eraser still works outside Erase mode');
});
(0, node_test_1.default)('load repaints only pages whose rendered strokes changed', async (t) => {
    const f = await fixture(t);
    const strokes = [1, 2].map((page) => ({
        id: `stroke-${page}`,
        page,
        width: 3,
        color: '#123456',
        viewportWidth: 100,
        viewportHeight: 100,
        points: [
            { x: 10, y: 10 },
            { x: 20, y: 20 },
        ],
    }));
    f.controller.load(strokes);
    strict_1.default.deepEqual(f.pages.map((page) => page.drawingCanvas.clears), [1, 1]);
    f.controller.load(structuredClone(strokes));
    strict_1.default.deepEqual(f.pages.map((page) => page.drawingCanvas.clears), [1, 1]);
    const edited = structuredClone(strokes);
    edited[0].points[1].x = 25;
    f.controller.load(edited);
    strict_1.default.deepEqual(f.pages.map((page) => page.drawingCanvas.clears), [2, 1]);
    f.controller.load([edited[1]]);
    strict_1.default.deepEqual(f.pages.map((page) => page.drawingCanvas.clears), [3, 1]);
});
(0, node_test_1.default)('stroke completion, erase, and undo do not repaint unaffected pages', async (t) => {
    const f = await fixture(t);
    const secondPage = f.pages[1].drawingCanvas;
    f.fire('pointerdown', {}, secondPage);
    f.fire('pointermove', { clientX: 20 }, secondPage);
    f.fire('pointerup', { clientX: 20 }, secondPage);
    const pageTwoClears = secondPage.clears;
    strict_1.default.equal(pageTwoClears, 1);
    f.fire('pointerdown');
    f.fire('pointermove', { clientX: 20 });
    f.fire('pointerup', { clientX: 20 });
    strict_1.default.equal(f.pages[0].drawingCanvas.clears, 1);
    strict_1.default.equal(secondPage.clears, pageTwoClears);
    f.settings.mode = 'erase';
    f.fire('pointerdown', { clientX: 15 });
    strict_1.default.equal(f.pages[0].drawingCanvas.clears, 2);
    strict_1.default.equal(secondPage.clears, pageTwoClears);
    f.controller.undoLastStroke();
    strict_1.default.equal(f.pages[0].drawingCanvas.clears, 2);
    strict_1.default.equal(secondPage.clears, pageTwoClears + 1);
});
(0, node_test_1.default)('disposing a replaced layer cancels its frame and removes pointer listeners', async (t) => {
    const f = await fixture(t);
    f.fire('pointerdown');
    f.fire('pointermove', { clientX: 20 });
    f.controller.dispose();
    strict_1.default.equal(f.frames.size, 0);
    f.fire('pointerup');
    f.fire('pointerdown');
    f.tick();
    strict_1.default.equal(f.pages[0].drawingCanvas.clears, 0);
    strict_1.default.equal(f.changes.length, 0);
});
(0, node_test_1.default)('scheduled previews respect page identity and zoom-scaled coordinates', async (t) => {
    const f = await fixture(t);
    const canvas = f.pages[1].drawingCanvas;
    canvas.width = 200;
    canvas.height = 300;
    f.fire('pointerdown', { clientX: 20, clientY: 20 }, canvas);
    f.fire('pointermove', { clientX: 25, clientY: 30 }, canvas);
    f.tick();
    strict_1.default.equal(f.pages[0].drawingCanvas.clears, 0);
    strict_1.default.equal(canvas.clears, 0);
    f.fire('pointerup', { clientX: 30, clientY: 40 }, canvas);
    strict_1.default.equal(f.changes[0].stroke.page, 2);
    strict_1.default.equal(f.changes[0].stroke.viewportWidth, 200);
    strict_1.default.equal(f.changes[0].stroke.viewportHeight, 300);
    strict_1.default.deepEqual(f.changes[0].stroke.points, [
        { x: 40, y: 60 },
        { x: 60, y: 120 },
    ]);
    f.settings.mode = 'select';
    f.fire('pointerdown');
    f.fire('pointermove');
    strict_1.default.equal(f.frames.size, 0);
});
(0, node_test_1.default)('live rendering appends only new segments regardless of existing ink', async (t) => {
    const f = await fixture(t);
    f.controller.load(Array.from({ length: 1000 }, (_, index) => ({
        id: `existing-${index}`,
        page: (index % 2) + 1,
        width: 3,
        color: '#ff0000',
        viewportWidth: 100,
        viewportHeight: 100,
        points: [
            { x: 0, y: 0 },
            { x: 5, y: 5 },
        ],
    })));
    const canvas = f.pages[0].drawingCanvas;
    const clears = canvas.clears;
    const paints = canvas.paths.length;
    f.fire('pointerdown');
    f.tick();
    strict_1.default.equal(canvas.paths.length, paints, 'a stationary start needs no paint');
    for (let x = 11; x <= 60; x++) {
        f.fire('pointermove', { clientX: x });
        f.tick();
    }
    const previews = canvas.paths.slice(paints);
    strict_1.default.equal(previews.length, 50);
    strict_1.default.equal(canvas.clears, clears, 'live frames must not clear completed ink');
    strict_1.default.equal(previews[0].length, 2);
    strict_1.default.ok(previews.slice(1).every((points) => points.length === 3));
    for (let index = 1; index < previews.length; index++) {
        strict_1.default.deepEqual(previews[index][1], previews[index - 1].at(-1), 'segments connect across frames');
    }
    f.fire('pointerup', { clientX: 60 });
    strict_1.default.equal(f.changes[0].strokes.length, 1001);
    strict_1.default.deepEqual(f.changes[0].stroke.points, [
        { x: 10, y: 10 },
        { x: 60, y: 10 },
    ]);
});
(0, node_test_1.default)('simplification preserves corners, reversals, and endpoints within its tolerance', async () => {
    const { simplifyStrokePoints } = await drawingModule;
    const corners = [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
    ];
    strict_1.default.deepEqual(simplifyStrokePoints(corners, 0.25), corners);
    const reversal = [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 0, y: 0 },
    ];
    strict_1.default.deepEqual(simplifyStrokePoints(reversal, 0.25), reversal);
    const sampled = Array.from({ length: 1001 }, (_, x) => ({
        x,
        y: x === 0 || x === 1000 ? 0 : x % 2 ? 0.1 : -0.1,
    }));
    const reduced = simplifyStrokePoints(sampled, 0.25);
    strict_1.default.ok(reduced.length <= 3);
    strict_1.default.equal(reduced[0], sampled[0]);
    strict_1.default.equal(reduced.at(-1), sampled.at(-1));
    for (const point of sampled) {
        const distance = reduced
            .slice(1)
            .reduce((best, end, index) => {
            const start = reduced[index];
            const dx = end.x - start.x;
            const dy = end.y - start.y;
            const fraction = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) /
                (dx * dx + dy * dy)));
            return Math.min(best, Math.hypot(point.x - start.x - fraction * dx, point.y - start.y - fraction * dy));
        }, Number.POSITIVE_INFINITY);
        strict_1.default.ok(distance <= 0.25 + 1e-9);
    }
});
(0, node_test_1.default)('long strokes simplify across bounded chunks without stack growth', async () => {
    const { simplifyStrokePoints } = await drawingModule;
    const sampled = Array.from({ length: 8193 }, (_, x) => ({ x, y: 0 }));
    const reduced = simplifyStrokePoints(sampled, 0.25);
    strict_1.default.equal(reduced[0], sampled[0]);
    strict_1.default.equal(reduced.at(-1), sampled.at(-1));
    strict_1.default.equal(reduced.length, 17);
});
(0, node_test_1.default)('a full redraw mid-stroke resynchronizes the incremental preview cursor', async (t) => {
    const f = await fixture(t);
    f.controller.load([
        {
            id: 'existing',
            page: 1,
            width: 3,
            color: '#123456',
            viewportWidth: 100,
            viewportHeight: 100,
            points: [
                { x: 0, y: 0 },
                { x: 5, y: 5 },
            ],
        },
    ]);
    f.fire('pointerdown');
    f.fire('pointermove', { clientX: 20 });
    f.tick();
    f.fire('pointermove', { clientX: 30 });
    f.controller.removeStroke('existing');
    strict_1.default.equal(f.frames.size, 0);
    strict_1.default.equal(f.pages[0].drawingCanvas.paths.at(-1)?.length, 3);
    f.fire('pointermove', { clientX: 40 });
    f.tick();
    strict_1.default.deepEqual(f.pages[0].drawingCanvas.paths.at(-1), [
        { x: 20, y: 10 },
        { x: 30, y: 10 },
        { x: 40, y: 10 },
    ]);
    f.fire('pointerup', { clientX: 40 });
    f.fire('pointerdown', { clientX: 50 });
    f.fire('pointermove', { clientX: 60 });
    f.tick();
    strict_1.default.deepEqual(f.pages[0].drawingCanvas.paths.at(-1), [
        { x: 50, y: 10 },
        { x: 60, y: 10 },
    ]);
});
//# sourceMappingURL=drawingLayer.test.js.map