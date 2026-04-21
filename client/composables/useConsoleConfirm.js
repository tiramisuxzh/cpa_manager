import { onBeforeUnmount, reactive } from "vue";

function initialDialog() {
  // 确认弹窗默认支持摘要、清单和补充说明三段内容，批量操作时直接展示完整清单。
  return {
    visible: false,
    title: "",
    message: "",
    items: [],
    listTitle: "",
    note: "",
    confirmText: "确认",
    cancelText: "取消",
    tone: "danger"
  };
}

// 所有危险操作统一走这个确认弹窗，避免浏览器原生 confirm 破坏整体交互体验。
export function useConsoleConfirm() {
  var dialog = reactive(initialDialog());
  var resolver = null;

  function resetDialog() {
    Object.assign(dialog, initialDialog());
  }

  function settle(result) {
    var currentResolver = resolver;
    resolver = null;
    resetDialog();
    if (currentResolver) {
      currentResolver(!!result);
    }
  }

  function askConfirm(options) {
    if (resolver) {
      settle(false);
    }
    Object.assign(dialog, initialDialog(), options || {}, { visible: true });
    return new Promise(function (resolve) {
      resolver = resolve;
    });
  }

  function confirm() {
    settle(true);
  }

  function cancel() {
    settle(false);
  }

  onBeforeUnmount(function () {
    settle(false);
  });

  return {
    dialog: dialog,
    askConfirm: askConfirm,
    confirm: confirm,
    cancel: cancel
  };
}
