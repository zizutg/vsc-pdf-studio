export function createFormController({
  state,
  vscode,
  applyTextFieldValidationState,
  createSelectControl,
  getButtonActionState,
  getTextFieldValidationError,
  normalizeDateValueForInput,
  normalizeDateValueForStorage,
  slugify,
  requestSave,
}) {
  let formSaveTimer = null;

  function updateFormFieldValue(name, nextValue) {
    state.formFields = state.formFields.map((field) => {
      if (field.name !== name) {
        return field;
      }

      if (field.type === 'text') {
        return {
          ...field,
          value: typeof nextValue === 'string' ? nextValue : '',
        };
      }

      if (field.type === 'checkbox') {
        return {
          ...field,
          checked: Boolean(nextValue),
        };
      }

      if (field.type === 'radio') {
        return {
          ...field,
          value:
            typeof nextValue === 'string' && nextValue.length
              ? nextValue
              : null,
        };
      }

      return {
        ...field,
        value: Array.isArray(nextValue) ? nextValue : [],
      };
    });
  }

  function queueFormFieldSave() {
    if (formSaveTimer) {
      window.clearTimeout(formSaveTimer);
    }

    formSaveTimer = window.setTimeout(() => {
      formSaveTimer = null;
      requestSave();
    }, 300);
  }

  function activateButtonField(name) {
    const now = Date.now();
    if (
      state.lastButtonActivation &&
      state.lastButtonActivation.name === name &&
      now < state.lastButtonActivation.until
    ) {
      return;
    }

    if (formSaveTimer) {
      window.clearTimeout(formSaveTimer);
      formSaveTimer = null;
    }

    state.lastButtonActivation = {
      name,
      until: now + 1000,
    };
    state.saveInFlight = true;
    state.saveQueued = false;

    vscode.postMessage({
      type: 'buttonActivated',
      payload: {
        name,
        annotations: {
          version: state.sessionAnnotations.version,
          strokes: state.sessionAnnotations.strokes,
          highlights: state.sessionAnnotations.highlights,
          comments: state.sessionAnnotations.comments,
          updatedAt: new Date().toISOString(),
        },
        formFields: state.formFields,
      },
    });
  }

  function renderFormFields() {
    for (const pageEntry of state.pageEntries) {
      pageEntry.formLayer.replaceChildren();
    }

    for (const field of state.formFields) {
      for (const widget of field.widgets) {
        const pageEntry = state.pageEntries.find(
          (entry) => entry.pageNumber === widget.page
        );
        if (!pageEntry) {
          continue;
        }

        const scaleX =
          pageEntry.width / Math.max(pageEntry.pdfWidth || pageEntry.width, 1);
        const scaleY =
          pageEntry.height /
          Math.max(pageEntry.pdfHeight || pageEntry.height, 1);
        const left = widget.x * scaleX;
        const top = widget.y * scaleY;
        const width = widget.width * scaleX;
        const height = widget.height * scaleY;

        let control = null;

        if (field.type === 'text') {
          control = document.createElement(
            field.multiline ? 'textarea' : 'input'
          );
          control.className = 'pdf-form-control pdf-form-text';
          if (control instanceof HTMLInputElement) {
            control.type =
              field.semantic === 'email'
                ? 'email'
                : field.semantic === 'date'
                  ? 'date'
                  : 'text';
            control.value =
              field.semantic === 'date'
                ? normalizeDateValueForInput(field.value)
                : field.value;
            if (field.semantic === 'fullName') {
              control.autocomplete = 'name';
            } else if (field.semantic === 'email') {
              control.autocomplete = 'email';
              control.inputMode = 'email';
              control.spellcheck = false;
            } else if (field.semantic === 'date') {
              control.autocomplete = 'off';
              control.inputMode = 'none';
            }
          } else {
            control.value = field.value;
          }
          if (field.maxLength) {
            control.maxLength = field.maxLength;
          }
          control.disabled = field.readOnly || state.mode !== 'select';
          applyTextFieldValidationState(control, field, field.value);
          control.addEventListener('input', () => {
            const nextValue =
              field.semantic === 'date'
                ? normalizeDateValueForStorage(control.value)
                : control.value;
            const validationError = getTextFieldValidationError(
              field,
              nextValue
            );
            applyTextFieldValidationState(control, field, nextValue);
            if (validationError) {
              return;
            }
            updateFormFieldValue(field.name, nextValue);
            queueFormFieldSave();
          });
        } else if (field.type === 'checkbox') {
          control = document.createElement('input');
          control.type = 'checkbox';
          control.className = 'pdf-form-control pdf-form-check';
          control.checked = field.checked;
          control.disabled = field.readOnly || state.mode !== 'select';
          control.addEventListener('change', () => {
            updateFormFieldValue(field.name, control.checked);
            queueFormFieldSave();
          });
        } else if (field.type === 'radio') {
          control = document.createElement('input');
          control.type = 'radio';
          control.className = 'pdf-form-control pdf-form-check';
          control.name = `pdf-radio-${slugify(field.name)}`;
          control.checked = field.value === (widget.option ?? null);
          control.disabled = field.readOnly || state.mode !== 'select';
          control.addEventListener('change', () => {
            if (!control.checked) {
              return;
            }

            updateFormFieldValue(field.name, widget.option ?? null);
            renderFormFields();
            queueFormFieldSave();
          });
        } else if (field.type === 'dropdown') {
          if (field.editable) {
            control = document.createElement('input');
            control.type = 'text';
            control.className = 'pdf-form-control pdf-form-text';
            control.value = field.value[0] ?? '';
            control.disabled = field.readOnly || state.mode !== 'select';
            const listId = `pdf-form-list-${slugify(field.name)}-${slugify(widget.id)}`;
            control.setAttribute('list', listId);
            const datalist = document.createElement('datalist');
            datalist.id = listId;
            for (const option of field.options) {
              const optionEl = document.createElement('option');
              optionEl.value = option;
              datalist.append(optionEl);
            }
            pageEntry.formLayer.append(datalist);
            control.addEventListener('input', () => {
              updateFormFieldValue(
                field.name,
                control.value ? [control.value] : []
              );
              queueFormFieldSave();
            });
          } else {
            control = createSelectControl(field, {
              interactive: state.mode === 'select',
              onChange(selectedValues) {
                updateFormFieldValue(field.name, selectedValues);
                queueFormFieldSave();
              },
            });
          }
        } else if (field.type === 'optionList') {
          control = createSelectControl(field, {
            interactive: state.mode === 'select',
            onChange(selectedValues) {
              updateFormFieldValue(field.name, selectedValues);
              queueFormFieldSave();
            },
          });
        } else if (field.type === 'button') {
          control = document.createElement('button');
          control.type = 'button';
          control.className =
            'pdf-form-control pdf-form-button is-studio-overlay';
          control.textContent = field.label;
          const actionState = getButtonActionState(field);
          control.disabled =
            field.readOnly || state.mode !== 'select' || !actionState.enabled;
          control.dataset.enabled = String(actionState.enabled);
          control.dataset.actionType = field.action?.type || 'none';
          control.title = actionState.title;
          control.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            activateButtonField(field.name);
          });
        }

        if (!control) {
          continue;
        }

        control.dataset.readOnly = String(Boolean(field.readOnly));
        if (!control.dataset.enabled) {
          control.dataset.enabled = 'true';
        }
        control.style.left = `${left}px`;
        control.style.top = `${top}px`;
        control.style.width = `${width}px`;
        control.style.height = `${height}px`;
        pageEntry.formLayer.append(control);
      }
    }
  }

  return {
    renderFormFields,
    updateFormFieldValue,
    queueFormFieldSave,
    activateButtonField,
  };
}
