#!/usr/bin/env python3
"""Alias for tools/publish_opinion.py (kept for old notes/scripts)."""
import os, runpy, sys
sys.argv[0] = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'publish_opinion.py')
runpy.run_path(sys.argv[0], run_name='__main__')
