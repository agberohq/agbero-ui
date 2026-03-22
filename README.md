# Agbero

> A dynamic, high-performance reverse proxy and API Gateway built in Go.

Agbero is designed to route traffic securely, reliably, and efficiently across distributed backends, microservices, and static web directories. It uses **HCL (HashiCorp Configuration Language)** for clean, readable configuration files and features a zero-downtime hot-reloading architecture.

## Features

- **HCL Configuration:** Expressive, human-readable configuration files.
- **Zero-Downtime Hot Reloads:** Drop a new `.hcl` file into your hosts directory, and Agbero will parse and seamlessly reload the routing logic without dropping active connections.
- **Auto TLS (Let's Encrypt):** Built-in automatic certificate provisioning, renewal, and management. Also supports local certificates and custom CAs.
- **WASM Middleware:** Extend proxy logic dynamically using WebAssembly plugins.
- **Advanced Traffic Management:**
    - Global and Route-level Rate Limiting.
    - Active Circuit Breaking.
    - TCP and HTTP Health Checks.
- **Integrated Web Serving:** Serve static files (`index.html`), directories, Git repositories, or route directly to FastCGI/PHP application servers.
- **Built-in Security:**
    - Active Request Firewall (WAF).
    - CORS Management.
    - Basic Auth, JWT Verification, OAuth, and Forward Auth plugins natively supported.
- **Oja SPA Admin Dashboard:** A beautifully designed, framework-agnostic Single Page Application providing real-time telemetry, log streaming, JSON-based config editing, and visual network topology maps.

## Architecture

Agbero is broken down into distinct engines:

1. **Global Settings (`agbero.hcl`)**: Binds ports, configures logging (Prometheus/VictoriaMetrics), sets global WAF rules, and configures distributed clustering (Gossip protocol).
2. **Hosts (`/hosts/*.hcl`)**: Domain-specific routing files. Maps incoming domains to downstream handlers.
3. **Engines**:
    - `Web`: Static file servers, Git, PHP.
    - `Backend`: HTTP/TCP load balancers (Round Robin, Least Conn, etc.).
    - `Serverless`: Execution environments for OS Workers and REST APIs.

## The Admin Dashboard

Agbero ships with an integrated, zero-dependency admin dashboard built on **Oja** (a micro frontend layout engine).

### Accessing the Dashboard
Ensure your `agbero.hcl` has the admin block enabled:

```hcl
admin {
    enabled = "on"
    address = ":9090"
    
    basic_auth {
        enabled = "on"
        users   = ["admin:hashed_password"]
    }
    
    jwt_auth {
        enabled = "on"
        secret  = "super_secret_key"
    }
}