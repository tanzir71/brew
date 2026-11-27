#!/usr/bin/env node
import process from 'node:process';
import { runCli } from '../dist/main.js';
import { DeployError } from '../dist/model.js';
try {
  await runCli();
} catch (error) {
  process.stderr.write(
    (error instanceof DeployError
      ? error.message
      : 'Brew deployment stopped. Keep the deployment directory and rerun to resume.') + '\n',
  );
  process.exitCode = 1;
}
