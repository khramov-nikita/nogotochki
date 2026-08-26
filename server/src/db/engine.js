const MIN_MAJOR = 22;
const MIN_MINOR = 16;

export const REQUIRED_NODE = `${MIN_MAJOR}.${MIN_MINOR}`;

export function assertNodeForSqlite() {
  const [major, minor] = process.versions.node.split(".").map(Number);
  const tooOld =
    Number.isNaN(major) ||
    Number.isNaN(minor) ||
    major < MIN_MAJOR ||
    (major === MIN_MAJOR && minor < MIN_MINOR);

  if (tooOld) {
    throw new Error(
      `Нужен Node.js ${REQUIRED_NODE} или новее (сейчас ${process.version}). ` +
        `База идёт через встроенный node:sqlite, без native-модуля. ` +
        `На BeGet поставьте Node 22 LTS (не ниже ${REQUIRED_NODE}) или Node 24.`,
    );
  }
}
