# Backend Service

This backend service provides APIs for fetching and caching LiFi routes and slippage data for the Etherlink blockchain.

## Environment Variables

Create a `.env` file in the backend directory with the following variables:

```bash
# Server Configuration
PORT=3001

# LiFi API Configuration
LIFI_API_KEY=your_lifi_api_key_here

# Startup Behavior Control
# Set to 'true' to fetch routes on startup, 'false' to skip
FETCH_ROUTES_ON_STARTUP=true

# Set to 'true' to fetch slippage data on startup, 'false' to skip
FETCH_SLIPPAGE_ON_STARTUP=true
```

## Features

### Automatic Data Fetching

- **Routes**: Fetched once per day at 00:00 UTC
- **Slippage Data**: Fetched once per day at 00:00 UTC

### Manual Triggers

- **POST /routes/fetch**: Manually trigger routes fetching
- **POST /slippage/calculate**: Manually trigger slippage calculation
- **GET /slippage/status**: Check slippage cache status

### API Endpoints

- **GET /healthz**: Health check
- **GET /tokens**: Get all available tokens
- **GET /routes**: Get cached routes
- **GET /slippage**: Get cached slippage data
- **POST /routes/fetch**: Manually trigger routes fetching
- **POST /slippage/calculate**: Manually trigger slippage calculation
- **GET /slippage/status**: Get slippage cache status

## Startup Behavior

The service can be configured to skip initial data fetching on startup by setting the environment variables to `false`. This is useful for:

- Development environments where you want to control when data is fetched
- Production environments where you want to avoid API calls during deployment
- Testing scenarios where you want to start with empty caches

## Configuration Examples

### Development (skip startup fetching)

```bash
FETCH_ROUTES_ON_STARTUP=false
FETCH_SLIPPAGE_ON_STARTUP=false
```

### Production (fetch on startup)

```bash
FETCH_ROUTES_ON_STARTUP=true
FETCH_SLIPPAGE_ON_STARTUP=true
```

## Rate Limiting

The service includes built-in rate limiting to respect LiFi API limits:

- Maximum 10 requests per hour for slippage calculations
- Delays between requests to avoid hitting rate limits
- Automatic retry logic for rate-limited requests

## Manual Operations

You can manually trigger data fetching via API endpoints:

```bash
# Trigger routes fetch
curl -X POST http://localhost:3001/routes/fetch

# Trigger slippage calculation
curl -X POST http://localhost:3001/slippage/calculate

# Check slippage status
curl http://localhost:3001/slippage/status
```
