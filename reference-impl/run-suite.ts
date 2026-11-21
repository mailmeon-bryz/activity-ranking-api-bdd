/**
 * Boots the throwaway reference implementation wired to the Open-Meteo stub, then runs the
 * unchanged acceptance suite against it via API_BASE_URL. Exit code = Cucumber's exit code.
 *   npm run test:reference [-- <extra cucumber args>]
 */
import { spawn } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import { createReferenceServer } from './server';

const stubPort = process.env.STUB_PORT ?? '4010';
const stub = `http://localhost:${stubPort}`;
process.env.OPEN_METEO_GEOCODING_URL = `${stub}/geocoding/search`;
process.env.OPEN_METEO_FORECAST_URL = `${stub}/forecast`;
process.env.OPEN_METEO_MARINE_URL = `${stub}/marine`;
process.env.OPEN_METEO_TIMEOUT_MS ??= '5000';

async function main(): Promise<void> {
  const server = createReferenceServer();
  await new Promise<void>((resolve) => server.listen(Number(process.env.PORT ?? 3100), resolve));
  const { port } = server.address() as AddressInfo;

  const cucumber = spawn('npx', ['cucumber-js', ...process.argv.slice(2)], {
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, API_BASE_URL: `http://localhost:${port}` },
  });
  cucumber.on('exit', (code) => {
    server.closeAllConnections();
    server.close();
    process.exit(code ?? 1);
  });
}

void main();
