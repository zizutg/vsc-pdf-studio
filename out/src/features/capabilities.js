"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createDefaultCapabilities = createDefaultCapabilities;
exports.hasFeature = hasFeature;
function createDefaultCapabilities() {
    return {
        tier: 'free',
        features: {
            annotate: true,
            highlight: true,
            comment: true,
            search: true,
            outline: true,
            pageNavigation: true,
            copySelection: true,
            formFill: true,
        },
    };
}
function hasFeature(capabilities, feature) {
    return Boolean(capabilities.features[feature]);
}
//# sourceMappingURL=capabilities.js.map