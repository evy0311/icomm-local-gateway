const response = await fetch("http://127.0.0.1:8081/health", { signal: AbortSignal.timeout(1500) });
if (!response.ok) process.exit(1);
