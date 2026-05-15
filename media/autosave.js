export function createAutoSaver(callback, delay = 800) {
  let timer = null;

  return {
    queue(payload) {
      if (timer) {
        clearTimeout(timer);
      }

      timer = setTimeout(() => {
        timer = null;
        callback(payload);
      }, delay);
    }
  };
}
