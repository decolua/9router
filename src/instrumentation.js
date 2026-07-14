// Rename process to distinguish 9router from generic next-server
export function register() {
  if (process.title.startsWith('next-server')) {
    process.title = process.title.replace('next-server', '9router');
  }
}
