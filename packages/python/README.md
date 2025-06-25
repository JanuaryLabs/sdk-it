# Python SDK Generator

This package generates Python SDKs from OpenAPI specifications. The generated SDKs are type-safe, use Pydantic for data validation, and follow Python best practices.

## Generated SDK Features

- **Type Safety**: Full type hints using Python's typing system
- **Data Validation**: Pydantic models for request/response validation
- **Async Support**: Fully async HTTP client using `httpx`
- **Error Handling**: Proper exception hierarchy for API errors
- **Documentation**: Auto-generated docstrings from OpenAPI descriptions

## Generated SDK Structure

```
├── requirements.txt          # Python dependencies
├── client.py                # Main client class
├── api/                     # API group clients
│   ├── __init__.py
│   ├── users_api.py
│   └── pets_api.py
├── models/                  # Data models
│   ├── __init__.py
│   ├── user.py
│   └── pet.py
├── inputs/                  # Request input models
│   ├── __init__.py
│   └── ...
├── outputs/                 # Response output models
│   ├── __init__.py
│   └── ...
└── http/                    # HTTP transport layer
    ├── __init__.py
    ├── dispatcher.py
    ├── interceptors.py
    └── responses.py
```

## Usage

```python
import asyncio
from your_sdk import Client

async def main():
    client = Client(base_url="https://api.example.com")

    # Make API calls
    users = await client.users.list_users()
    user = await client.users.get_user(user_id="123")

if __name__ == "__main__":
    asyncio.run(main())
```

## Dependencies

The generated SDK has minimal dependencies:

- `httpx` - Modern async HTTP client
- `pydantic` - Data validation and serialization
- `typing-extensions` - Enhanced type hints support
