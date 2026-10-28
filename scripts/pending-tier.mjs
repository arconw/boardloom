const [command, task] = process.argv.slice(2);

if (!command || !task) {
  console.error("usage: node scripts/pending-tier.mjs <command> <owning-task>");
  process.exitCode = 2;
} else {
  console.error(
    `${command} is a reserved quality command from the TASKS.md command contract. It is implemented by ${task} and is not available in the T01 foundation. No pass is claimed.`,
  );
  process.exitCode = 2;
}
