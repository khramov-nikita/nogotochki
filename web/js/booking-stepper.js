const STEPS = [
  { n: 1, label: "Услуги", href: "booking.html" },
  { n: 2, label: "Мастер", href: "booking-master.html" },
  { n: 3, label: "Дата и время", href: "booking-datetime.html" },
  { n: 4, label: "Проверка" },
  { n: 5, label: "Готово" },
];

export function renderStepper(current, options = {}) {
  const linkDone = options.linkDone !== false;
  const items = STEPS.flatMap((step, index) => {
    const line = index ? `<div class="stepper-line" aria-hidden="true"></div>` : "";
    const isDone = step.n < current;
    const isCurrent = step.n === current;
    const check = isDone ? `<span class="icon icon--check" aria-hidden="true"></span>` : "";
    const inner = `<span>${step.n}</span><span>${step.label}</span>${check}`;

    let node;
    if (isDone && linkDone && step.href) {
      node = `<a class="step step--done" href="${step.href}">${inner}</a>`;
    } else if (isDone) {
      node = `<div class="step step--done">${inner}</div>`;
    } else if (isCurrent) {
      node = `<div class="step step--current" aria-current="step">${inner}</div>`;
    } else {
      node = `<div class="step">${inner}</div>`;
    }

    return [line, node];
  });

  return `<nav class="stepper" aria-label="Шаги записи">${items.join("")}</nav>`;
}
