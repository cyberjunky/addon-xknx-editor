"""XKNX Editor web backend (Home Assistant add-on).

Copyright (C) 2026 Ron Klinkien

This program is free software; you can redistribute it and/or modify it under the terms of the
GNU General Public License as published by the Free Software Foundation; version 2 of the License
only. This program is distributed WITHOUT ANY WARRANTY; see the LICENSE file for details.
"""

import os

# The Supervisor builds the image with the add-on's version from config.yaml (BUILD_VERSION); the
# Dockerfile hands it on. Outside the image (tests, development) there is none.
__version__ = os.environ.get("XKNX_ADDON_VERSION") or "dev"
