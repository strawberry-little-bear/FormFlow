FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /srv/formflow

COPY requirements.lock requirements.txt ./
RUN python -m pip install --no-cache-dir --require-hashes -r requirements.lock \
    && useradd --create-home --uid 10001 formflow

COPY app ./app
COPY scripts ./scripts
COPY README.md LICENSE .env.example ./

RUN mkdir -p /srv/formflow/data \
    && chown -R formflow:formflow /srv/formflow

USER formflow
EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
