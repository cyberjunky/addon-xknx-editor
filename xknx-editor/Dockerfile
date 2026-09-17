# syntax=docker/dockerfile:1
#
# Home Assistant add-on: XKNX Editor
#
# Two stages on the same base image so the CPython in /venv matches the runtime exactly:
#   builder  - builds wheels from the vendored editor sources (vendor/xknx-editor) and installs
#              them plus the web backend (app/) into /venv with uv. The desktop GUI package and
#              imgui are left out.
#   frontend - builds the Lit/Vite single-page app (frontend/) into static assets.
#   final    - copies /venv, the built SPA and the s6 service.
#
# Licence: this add-on is GPL-2.0-only (see /LICENSE). The vendored editor sources' snapshot is
# recorded in vendor/UPSTREAM_COMMIT and every local change is a patch under vendor/patches/.

ARG BUILD_FROM=ghcr.io/home-assistant/amd64-base-python:3.13-alpine3.23-2026.08.0

FROM ghcr.io/astral-sh/uv:0.5.9 AS uv

#########################################################################
# Frontend (Lit + Vite), built on the build host's architecture
#########################################################################
# hadolint ignore=DL3029
FROM --platform=$BUILDPLATFORM node:22-alpine AS frontend
WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

#########################################################################
# Builder
#########################################################################
# hadolint ignore=DL3006
FROM ${BUILD_FROM} AS builder

COPY --from=uv /uv /bin/uv

# build-base/libffi-dev: fallback for any dependency without a musllinux wheel on this
# architecture.
# hadolint ignore=DL3018
RUN apk add --no-cache build-base libffi-dev

# The editor sources are vendored in this repository (vendor/xknx-editor, snapshot recorded in
# vendor/UPSTREAM_COMMIT, changes in vendor/patches/); nothing is fetched from the upstream
# repository. The build context carries them either as the directory itself (a git clone: the
# add-on store installs this way) or as ONE tarball (vendor/xknx-editor.tar.gz, produced by
# tools/pack-vendor.ps1 and the CI workflows, because copying ~3800 small files to the Home
# Assistant addons share takes far longer than the build itself). The tarball wins when both exist.
COPY vendor/ /tmp/vendor/
RUN mkdir -p /src /wheels-vendor \
    && if [ -f /tmp/vendor/xknx-editor.tar.gz ]; then \
         tar -xzf /tmp/vendor/xknx-editor.tar.gz -C /src --strip-components=1; \
       elif [ -d /tmp/vendor/xknx-editor/packages ]; then \
         cp -a /tmp/vendor/xknx-editor/. /src/; \
       else \
         echo "vendor/xknx-editor is missing from the build context" >&2; exit 1; \
       fi \
    && cp /tmp/vendor/UPSTREAM_COMMIT /src/UPSTREAM_COMMIT \
    && cp -a /tmp/vendor/wheels/. /wheels-vendor/ \
    && rm -rf /tmp/vendor

ENV UV_PYTHON_DOWNLOADS=never \
    UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1

# Build plain wheels for the seven libraries, then install them into a fresh venv from outside the
# workspace. Installing through `uv sync`/workspace resolution re-installs members as *editable*
# links into /src, which does not exist in the final image (that is how the first build lost
# xknxeditor.namespaces). Wheels have no such link.
#
# xknxproject is a wheel built from the commit upstream's uv.lock pins (PR #634, not yet on PyPI),
# vendored under vendor/wheels so the build needs nothing from GitHub.
# pydantic is imported by xknxeditor-catalog but not declared by it (upstream packaging bug;
# the desktop app only works because fastmcp pulls it in). starlette/uvicorn serve the status app.
WORKDIR /src
RUN for p in namespaces prod catalog proj datasecure download recover dali; do \
        uv build --wheel --package "xknxeditor-${p}" --out-dir /wheels || exit 1; \
    done

COPY app /build/app

WORKDIR /
RUN uv venv /venv --python "$(command -v python3)" \
    && uv pip install --no-config --python /venv/bin/python --no-cache \
        /wheels/*.whl \
        /wheels-vendor/*.whl \
        "pydantic>=2" \
        /build/app \
    # The MCP server uses the official MCP Python SDK (MIT). It is installed without its
    # python-multipart dependency (Apache-2.0, only needed for OAuth form endpoints we do not use)
    # so the image stays GPL-2.0-compatible; every other dependency is MIT/BSD/PSF.
    # The Home Assistant wheel index (first index in the base image) tops out at mcp 1.26 and uv
    # does not fall through to PyPI for newer versions; 1.26 has everything the bridge uses.
    && uv pip install --no-config --python /venv/bin/python --no-cache --no-deps "mcp>=1.26" \
    && uv pip install --no-config --python /venv/bin/python --no-cache \
        "anyio>=4.5" "httpx>=0.27.1" "httpx-sse>=0.4" "jsonschema>=4.20" "pydantic-settings>=2.5.2" \
        "pyjwt>=2.10.1" "sse-starlette>=1.6.1" "typing-inspection>=0.4.1" \
    && cp /src/UPSTREAM_COMMIT /venv/upstream-ref

#########################################################################
# Final image
#########################################################################
# hadolint ignore=DL3006
FROM ${BUILD_FROM}

ARG BUILD_ARCH
ARG BUILD_DATE
ARG BUILD_REF
ARG BUILD_VERSION
COPY --from=builder /venv /venv
COPY --from=frontend /build/frontend/dist /opt/xknx-editor/static
COPY --from=builder /src/LICENSE /usr/share/licenses/xknx-editor/LICENSE
COPY LICENSE /usr/share/licenses/addon-xknx-editor/LICENSE
COPY rootfs /

RUN chmod a+x /etc/services.d/xknx-editor/run /etc/services.d/xknx-editor/finish

ENV PATH="/venv/bin:${PATH}" \
    PYTHONUNBUFFERED=1 \
    XKNX_ADDON_VERSION="${BUILD_VERSION}"

LABEL \
    io.hass.name="XKNX Editor (${BUILD_ARCH})" \
    io.hass.description="Home Assistant add-on: XKNX Editor" \
    io.hass.arch="${BUILD_ARCH}" \
    io.hass.type="addon" \
    io.hass.version="${BUILD_VERSION}" \
    maintainer="Ron Klinkien (cyberjunky)" \
    org.opencontainers.image.title="XKNX Editor add-on (${BUILD_ARCH})" \
    org.opencontainers.image.description="Home Assistant add-on: XKNX Editor" \
    org.opencontainers.image.licenses="GPL-2.0-only" \
    org.opencontainers.image.source="https://github.com/cyberjunky/addon-xknx-editor" \
    org.opencontainers.image.documentation="https://github.com/cyberjunky/addon-xknx-editor/blob/main/README.md" \
    org.opencontainers.image.created="${BUILD_DATE}" \
    org.opencontainers.image.revision="${BUILD_REF}" \
    org.opencontainers.image.version="${BUILD_VERSION}"
