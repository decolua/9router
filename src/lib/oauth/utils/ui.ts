import chalk from "chalk";
import ora from "ora";

/**
 * UI Helper Functions
 */

export function success(message: string) {
  console.log(chalk.green(`\n✓ ${message}\n`));
}

export function error(message: string) {
  console.log(chalk.red(`\n✗ ${message}\n`));
}

export function info(message: string) {
  console.log(chalk.blue(`\n${message}\n`));
}

export function warn(message: string) {
  console.log(chalk.yellow(`\n⚠ ${message}\n`));
}

export function gray(message: string) {
  console.log(chalk.gray(message));
}

export function spinner(text: string) {
  return ora(text);
}

export function printSection(title: string) {
  console.log(chalk.blue(`\n${title}\n`));
}

export function printKeyValue(key: string, value: any, isSuccess = false) {
  const color = isSuccess ? chalk.green : chalk.gray;
  console.log(color(`  ${key}: ${value}`));
}

export function printList(items: string[], isSuccess = false) {
  const symbol = isSuccess ? "✓" : "✗";
  const color = isSuccess ? chalk.green : chalk.gray;
  items.forEach((item) => {
    console.log(color(`  ${symbol} ${item}`));
  });
}
