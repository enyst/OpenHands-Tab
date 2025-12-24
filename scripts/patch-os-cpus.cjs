// Ensure Node reports at least one logical CPU. Some sandboxed environments
// return an empty array for os.cpus(), which breaks tooling that expects >=1.
const os = require('os');

const fallbackCpuInfo = [
  {
    model: 'virtual',
    speed: 0,
    times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 },
  },
];

const originalCpus = os.cpus;
try {
  const cpus = originalCpus.call(os);
  if (!Array.isArray(cpus) || cpus.length === 0) {
    os.cpus = () => fallbackCpuInfo;
  }
} catch {
  os.cpus = () => fallbackCpuInfo;
}

const originalAvailableParallelism = typeof os.availableParallelism === 'function' ? os.availableParallelism.bind(os) : undefined;
if (originalAvailableParallelism) {
  try {
    if (originalAvailableParallelism() <= 0) {
      os.availableParallelism = () => fallbackCpuInfo.length;
    }
  } catch {
    os.availableParallelism = () => fallbackCpuInfo.length;
  }
}

