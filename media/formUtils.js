export function getTextFieldValidationError(field, value) {
  const normalizedValue = value.trim();
  if (!normalizedValue) {
    return null;
  }

  if (field.semantic === 'email') {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedValue)
      ? null
      : 'Enter a valid email address.';
  }

  if (field.semantic === 'date') {
    if (
      /^\d{4}-\d{2}-\d{2}$/.test(normalizedValue) ||
      /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(normalizedValue)
    ) {
      return null;
    }
    return 'Use YYYY-MM-DD or MM/DD/YYYY.';
  }

  return null;
}

export function normalizeDateValueForInput(value) {
  const normalizedValue = value.trim();
  if (!normalizedValue) {
    return '';
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(normalizedValue)) {
    return normalizedValue;
  }

  const match = normalizedValue.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) {
    return normalizedValue;
  }

  const [, month, day, year] = match;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

export function normalizeDateValueForStorage(value) {
  return normalizeDateValueForInput(value);
}

export function applyTextFieldValidationState(control, field, value) {
  const validationError = getTextFieldValidationError(field, value);
  control.classList.toggle('is-invalid', Boolean(validationError));
  control.setAttribute('aria-invalid', validationError ? 'true' : 'false');

  if (validationError) {
    control.title = validationError;
    return;
  }

  if (field.semantic === 'date') {
    control.title =
      control instanceof HTMLInputElement && control.type === 'date'
        ? 'Pick a date from the calendar.'
        : 'Accepted formats: YYYY-MM-DD or MM/DD/YYYY';
  } else {
    control.removeAttribute('title');
  }
}

export function createSelectControl(field, { interactive, onChange }) {
  const select = document.createElement('select');
  select.className = `pdf-form-control pdf-form-select${field.type === 'optionList' ? ' is-list' : ''}`;
  select.disabled = field.readOnly || !interactive;
  if (field.multiSelect) {
    select.multiple = true;
  } else if (field.type === 'dropdown') {
    const emptyOption = document.createElement('option');
    emptyOption.value = '';
    emptyOption.textContent = '';
    emptyOption.selected = field.value.length === 0;
    select.append(emptyOption);
  }

  for (const option of field.options) {
    const optionEl = document.createElement('option');
    optionEl.value = option;
    optionEl.textContent = option;
    optionEl.selected = field.value.includes(option);
    select.append(optionEl);
  }

  select.addEventListener('change', () => {
    const selectedValues = Array.from(select.selectedOptions).map(
      (option) => option.value
    );
    onChange(selectedValues);
  });

  return select;
}

export function getButtonActionState(field) {
  if (!field.action) {
    return {
      enabled: false,
      title: 'This PDF button has no supported action.',
    };
  }

  if (field.action.type === 'unsupported') {
    return {
      enabled: false,
      title:
        field.action.reason || 'This PDF button uses an unsupported action.',
    };
  }

  if (field.action.type === 'submit') {
    return {
      enabled: Boolean(field.action.url),
      title: field.action.url
        ? `Submit form to ${field.action.url}`
        : 'This PDF button has no usable submit target.',
    };
  }

  if (field.action.type === 'mailto') {
    return {
      enabled: Boolean(field.action.url),
      title: field.action.url
        ? `Open email client for ${field.action.url}`
        : 'This PDF button has no usable mail target.',
    };
  }

  if (field.action.type === 'uri') {
    return {
      enabled: Boolean(field.action.url),
      title: field.action.url
        ? `Open ${field.action.url}`
        : 'This PDF button has no usable link target.',
    };
  }

  if (field.action.type === 'reset') {
    return {
      enabled: true,
      title:
        'Reset form fields to the values from when this document was opened.',
    };
  }

  return {
    enabled: false,
    title: 'This PDF button has no supported action.',
  };
}
