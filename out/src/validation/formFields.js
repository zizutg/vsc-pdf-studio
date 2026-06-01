"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sanitizeFormFields = sanitizeFormFields;
const formField_1 = require("../../models/formField");
const MAX_FORM_FIELDS = 2_000;
const MAX_FORM_OPTIONS = 512;
const MAX_FIELD_VALUE_LENGTH = 8_000;
const MAX_FIELD_WIDGETS = 64;
function sanitizeFormFields(input) {
    if (!Array.isArray(input)) {
        return (0, formField_1.emptyFormFields)();
    }
    if (input.length > MAX_FORM_FIELDS) {
        throw new Error('Form payload exceeds field limit.');
    }
    return input
        .map((field) => sanitizeFormField(field))
        .filter((field) => field !== null);
}
function sanitizeFormField(input) {
    if (!isObject(input) || typeof input.type !== 'string') {
        return null;
    }
    switch (input.type) {
        case 'text':
            return sanitizeTextField(input);
        case 'checkbox':
            return sanitizeCheckboxField(input);
        case 'radio':
            return sanitizeRadioField(input);
        case 'dropdown':
            return sanitizeDropdownField(input);
        case 'optionList':
            return sanitizeOptionListField(input);
        case 'button':
            return sanitizeButtonField(input);
        default:
            return null;
    }
}
function sanitizeFieldBase(input) {
    const name = sanitizeName(input.name);
    const widgets = sanitizeWidgets(input.widgets);
    if (!name || !widgets.length) {
        return null;
    }
    return {
        name,
        readOnly: Boolean(input.readOnly),
        widgets,
    };
}
function sanitizeTextField(input) {
    const base = sanitizeFieldBase(input);
    if (!base) {
        return null;
    }
    return {
        ...base,
        type: 'text',
        value: sanitizeTextValue(input.value),
        multiline: Boolean(input.multiline),
        maxLength: sanitizeNullablePositiveInteger(input.maxLength),
        semantic: sanitizeTextSemantic(input.semantic),
    };
}
function sanitizeCheckboxField(input) {
    const base = sanitizeFieldBase(input);
    if (!base) {
        return null;
    }
    return {
        ...base,
        type: 'checkbox',
        checked: Boolean(input.checked),
    };
}
function sanitizeRadioField(input) {
    const base = sanitizeFieldBase(input);
    if (!base) {
        return null;
    }
    return {
        ...base,
        type: 'radio',
        value: typeof input.value === 'string' && input.value.length
            ? input.value.slice(0, MAX_FIELD_VALUE_LENGTH)
            : null,
        options: sanitizeOptions(input.options),
    };
}
function sanitizeDropdownField(input) {
    const base = sanitizeFieldBase(input);
    if (!base) {
        return null;
    }
    return {
        ...base,
        type: 'dropdown',
        value: sanitizeSelectedValues(input.value),
        options: sanitizeOptions(input.options),
        editable: Boolean(input.editable),
        multiSelect: Boolean(input.multiSelect),
    };
}
function sanitizeOptionListField(input) {
    const base = sanitizeFieldBase(input);
    if (!base) {
        return null;
    }
    return {
        ...base,
        type: 'optionList',
        value: sanitizeSelectedValues(input.value),
        options: sanitizeOptions(input.options),
        multiSelect: Boolean(input.multiSelect),
    };
}
function sanitizeButtonField(input) {
    const base = sanitizeFieldBase(input);
    if (!base) {
        return null;
    }
    return {
        ...base,
        type: 'button',
        label: typeof input.label === 'string' && input.label.trim().length
            ? input.label.trim().slice(0, MAX_FIELD_VALUE_LENGTH)
            : base.name,
        action: sanitizeButtonAction(input.action),
    };
}
function sanitizeButtonAction(input) {
    if (!isObject(input) || typeof input.type !== 'string') {
        return null;
    }
    const type = input.type === 'reset' ||
        input.type === 'submit' ||
        input.type === 'mailto' ||
        input.type === 'uri' ||
        input.type === 'unsupported'
        ? input.type
        : null;
    if (!type) {
        return null;
    }
    return {
        type,
        url: typeof input.url === 'string' && input.url.trim().length
            ? input.url.trim().slice(0, MAX_FIELD_VALUE_LENGTH)
            : null,
        method: input.method === 'GET' || input.method === 'POST' ? input.method : null,
        reason: typeof input.reason === 'string' && input.reason.trim().length
            ? input.reason.trim().slice(0, MAX_FIELD_VALUE_LENGTH)
            : null,
    };
}
function sanitizeWidgets(input) {
    if (!Array.isArray(input) || input.length > MAX_FIELD_WIDGETS) {
        return [];
    }
    return input
        .map((widget) => sanitizeWidget(widget))
        .filter((widget) => widget !== null);
}
function sanitizeWidget(input) {
    if (!isObject(input)) {
        return null;
    }
    const id = sanitizeName(input.id);
    const page = sanitizePositiveInteger(input.page);
    const x = sanitizeFiniteNumber(input.x);
    const y = sanitizeFiniteNumber(input.y);
    const width = sanitizePositiveNumber(input.width);
    const height = sanitizePositiveNumber(input.height);
    if (!id ||
        page === null ||
        x === null ||
        y === null ||
        width === null ||
        height === null) {
        return null;
    }
    return {
        id,
        page,
        x,
        y,
        width,
        height,
        option: typeof input.option === 'string' && input.option.length
            ? input.option.slice(0, MAX_FIELD_VALUE_LENGTH)
            : undefined,
    };
}
function sanitizeOptions(input) {
    if (!Array.isArray(input) || input.length > MAX_FORM_OPTIONS) {
        return [];
    }
    return input
        .filter((value) => typeof value === 'string')
        .map((value) => value.slice(0, MAX_FIELD_VALUE_LENGTH));
}
function sanitizeSelectedValues(input) {
    if (!Array.isArray(input)) {
        return [];
    }
    return input
        .filter((value) => typeof value === 'string')
        .slice(0, MAX_FORM_OPTIONS)
        .map((value) => value.slice(0, MAX_FIELD_VALUE_LENGTH));
}
function sanitizeTextValue(input) {
    return typeof input === 'string'
        ? input.slice(0, MAX_FIELD_VALUE_LENGTH)
        : '';
}
function sanitizeTextSemantic(input) {
    return input === 'fullName' || input === 'email' || input === 'date'
        ? input
        : 'generic';
}
function sanitizeNullablePositiveInteger(input) {
    return typeof input === 'number' && Number.isInteger(input) && input > 0
        ? input
        : null;
}
function sanitizePositiveInteger(input) {
    return typeof input === 'number' && Number.isInteger(input) && input > 0
        ? input
        : null;
}
function sanitizeFiniteNumber(input) {
    return typeof input === 'number' && Number.isFinite(input) ? input : null;
}
function sanitizePositiveNumber(input) {
    return typeof input === 'number' && Number.isFinite(input) && input > 0
        ? input
        : null;
}
function sanitizeName(input) {
    return typeof input === 'string' && input.trim().length > 0
        ? input.trim()
        : null;
}
function isObject(input) {
    return typeof input === 'object' && input !== null;
}
//# sourceMappingURL=formFields.js.map