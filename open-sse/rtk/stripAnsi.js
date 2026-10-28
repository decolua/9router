// Port of text::strip_ansi and the PHP utils' strip_ansi_and_controls.
const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]/g;
// Same control set as PHP utils CONTROL_RE: C0 controls except \t \n \r, plus DEL.
const CONTROL_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;

export function stripAnsi(input) {
  return input.replace(ANSI_RE, "");
}

export function stripAnsiAndControls(input) {
  return stripAnsi(input).replace(CONTROL_RE, "");
}
