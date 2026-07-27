# @sdk-it/python

Generate asynchronous Python SDKs from OpenAPI specifications.

## Generated SDK Features

- Pydantic request and response models
- Async HTTP transport using `httpx`
- API groups derived from OpenAPI tags
- Error classes for HTTP failures
- Docstrings derived from operation summaries and descriptions

## Generate an SDK

```bash
npx @sdk-it/cli@latest generate python \
  --spec ./openapi.json \
  --output ./your_sdk \
  --name Client
```

The CLI writes a complete Python package to `./your_sdk` and formats it with Black or Ruff when either formatter is available.

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

## Install Generated Dependencies

```bash
python -m pip install -r ./your_sdk/requirements.txt
```

Operation methods live in the generated `api/` modules and use snake_case `operationId` names. Follow those emitted signatures instead of flattening request inputs into keyword arguments.

## Dependencies

The generated `requirements.txt` includes:

- `httpx` - Modern async HTTP client
- `pydantic` - Data validation and serialization
- `typing-extensions` - Enhanced type hints support
- `python-dateutil` - Date and time handling
