#!/usr/bin/env python3
"""Mirror the official FileZilla macOS archives and propose a Cask update."""

from __future__ import annotations

import hashlib
import html
import os
import re
import subprocess
import sys
import tarfile
import tempfile
from html.parser import HTMLParser
from pathlib import Path, PurePosixPath
from urllib.parse import urljoin, urlparse
from urllib.request import Request, urlopen


REPOSITORY = "lbenicio/homebrew"
CASK_PATH = Path("Casks/filezilla.rb")
DOWNLOAD_PAGE = "https://filezilla-project.org/download.php?show_all=1&type=client"
APP_URL = "https://homebrew.lbenicio.dev/v1/downloads/filezilla/{version}/{filename}"
MAX_DOWNLOAD_SIZE = 200 * 1024 * 1024
ARCHITECTURES = {
    "arm": "macos-arm64",
    "intel": "macos-x86",
}


class LinkParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.links: list[tuple[str, str]] = []
        self._href: str | None = None
        self._text: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() != "a":
            return
        self._href = dict(attrs).get("href")
        self._text = []

    def handle_data(self, data: str) -> None:
        if self._href is not None:
            self._text.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() == "a" and self._href is not None:
            self.links.append((self._href, " ".join(self._text)))
            self._href = None
            self._text = []


def fetch(url: str, referer: str | None = None) -> bytes:
    if not is_official_filezilla_url(url):
        raise RuntimeError("FileZilla published a download link outside its official domain")
    headers = {"User-Agent": "Mozilla/5.0 (compatible; HomebrewCaskUpdater/1.0)"}
    if referer:
        headers["Referer"] = referer
    request = Request(url, headers=headers)
    try:
        with urlopen(request, timeout=60) as response:
            if not is_official_filezilla_url(response.geturl()):
                raise RuntimeError("FileZilla download redirected outside its official domain")
            chunks: list[bytes] = []
            size = 0
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                size += len(chunk)
                if size > MAX_DOWNLOAD_SIZE:
                    raise RuntimeError("Vendor download exceeded the 200 MiB safety limit")
                chunks.append(chunk)
            return b"".join(chunks)
    except RuntimeError:
        raise
    except Exception:
        # Avoid printing the URL: FileZilla's download links can contain short-lived tokens.
        raise RuntimeError("Could not retrieve the official FileZilla download page or archive") from None


def is_official_filezilla_url(url: str) -> bool:
    parsed = urlparse(url)
    hostname = (parsed.hostname or "").lower()
    return parsed.scheme == "https" and (
        hostname == "filezilla-project.org" or hostname.endswith(".filezilla-project.org")
    )


def release_metadata() -> tuple[str, dict[str, str], str]:
    page_bytes = fetch(DOWNLOAD_PAGE)
    page = page_bytes.decode("utf-8", errors="replace")
    text = html.unescape(re.sub(r"<[^>]+>", " ", page))
    version_match = re.search(
        r"The latest stable version of FileZilla Client is\s*([0-9]+(?:\.[0-9]+){1,3})",
        text,
        re.IGNORECASE,
    )
    if not version_match:
        raise RuntimeError("Could not identify the stable version on FileZilla's official download page")
    version = version_match.group(1)
    if not re.fullmatch(r"[0-9]+(?:\.[0-9]+){1,3}", version):
        raise RuntimeError("FileZilla returned an unexpected version format")

    parser = LinkParser()
    parser.feed(page)
    links = [(urljoin(DOWNLOAD_PAGE, href), f"{href} {label}") for href, label in parser.links]
    filenames = {
        arch: f"FileZilla_{version}_{platform}.app.tar.bz2"
        for arch, platform in ARCHITECTURES.items()
    }
    resolved: dict[str, str] = {}
    for arch, filename in filenames.items():
        matches = [url for url, candidate in links if filename in candidate]
        if len(matches) != 1:
            raise RuntimeError(f"Could not uniquely locate the official {arch} archive link")
        resolved[arch] = matches[0]

    checksum_name = f"FileZilla_{version}.sha512"
    checksum_links = [url for url, candidate in links if checksum_name in candidate]
    if len(checksum_links) != 1:
        raise RuntimeError("Could not uniquely locate FileZilla's published SHA-512 manifest")

    return version, resolved, checksum_links[0]


def expected_sha512(manifest: bytes, filename: str) -> str:
    text = manifest.decode("utf-8", errors="strict")
    for line in text.splitlines():
        match = re.match(r"^([0-9a-fA-F]{128})\s+\*?(.+?)\s*$", line)
        if match and PurePosixPath(match.group(2)).name == filename:
            return match.group(1).lower()
    raise RuntimeError(f"FileZilla's manifest has no SHA-512 entry for {filename}")


def verify_archive(path: Path, filename: str, published_sha512: str) -> tuple[str, str]:
    sha512 = hashlib.sha512()
    sha256 = hashlib.sha256()
    with path.open("rb") as archive_file:
        while chunk := archive_file.read(1024 * 1024):
            sha512.update(chunk)
            sha256.update(chunk)
    if sha512.hexdigest() != published_sha512:
        raise RuntimeError(f"SHA-512 verification failed for {filename}; refusing to upload it")

    try:
        with tarfile.open(path, mode="r:bz2") as archive:
            members = archive.getmembers()
    except (tarfile.TarError, OSError):
        raise RuntimeError(f"The official {filename} is not a valid bzip2 tar archive") from None

    safe_members = [PurePosixPath(member.name) for member in members]
    if any(path_part == ".." for member in safe_members for path_part in member.parts):
        raise RuntimeError(f"The official {filename} contains an unsafe archive path")
    if not any(member.as_posix().endswith("FileZilla.app/Contents/Info.plist") for member in safe_members):
        raise RuntimeError(f"The official {filename} does not contain the expected FileZilla.app bundle")

    return sha256.hexdigest(), sha512.hexdigest()


def aws_cli(*args: str) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(
        ["aws", *args, "--endpoint-url", r2_endpoint(), "--region", "auto", "--no-cli-pager"],
        check=False,
        capture_output=True,
        text=True,
        env=os.environ.copy(),
    )
    if result.returncode and not re.search(r"\b(404|Not Found|NoSuchKey|NoSuchObject)\b", result.stderr):
        # AWS CLI diagnostics may include request URLs; never echo them into Actions logs.
        raise RuntimeError("R2 request failed; check the R2 credentials and bucket access")
    return result


def r2_endpoint() -> str:
    account_id = os.environ.get("CLOUDFLARE_ACCOUNT_ID", "")
    if not re.fullmatch(r"[a-fA-F0-9]{32}", account_id):
        raise RuntimeError("Set the CLOUDFLARE_ACCOUNT_ID GitHub Secret to the Cloudflare account ID")
    if not os.environ.get("AWS_ACCESS_KEY_ID") or not os.environ.get("AWS_SECRET_ACCESS_KEY"):
        raise RuntimeError("Set the CLOUDFLARE_R2_ACCESS_KEY_ID and CLOUDFLARE_R2_SECRET_ACCESS_KEY GitHub Secrets")
    return f"https://{account_id}.r2.cloudflarestorage.com"


def mirror_archive(path: Path, version: str, filename: str, sha256: str) -> None:
    key = f"homebrew/applications/filezilla/{version}/{filename}"
    head = aws_cli(
        "s3api", "head-object", "--bucket", "cdn", "--key", key,
        "--query", "Metadata.sha256", "--output", "text",
    )
    if head.returncode == 0:
        if head.stdout.strip() != sha256:
            raise RuntimeError(f"Immutable R2 object already exists with a different checksum: {key}")
        print(f"R2 already has the verified {filename}")
        return
    if not re.search(r"\b(404|Not Found|NoSuchKey|NoSuchObject)\b", head.stderr):
        raise RuntimeError("Could not confirm whether the versioned R2 object already exists")

    put = aws_cli(
        "s3api", "put-object", "--bucket", "cdn", "--key", key,
        "--body", str(path), "--content-type", "application/x-bzip2",
        "--cache-control", "public, max-age=31536000, immutable",
        "--metadata", f"sha256={sha256}",
    )
    if put.returncode:
        raise RuntimeError(f"Could not upload the verified {filename} to R2")

    check = aws_cli(
        "s3api", "head-object", "--bucket", "cdn", "--key", key,
        "--query", "Metadata.sha256", "--output", "text",
    )
    if check.returncode or check.stdout.strip() != sha256:
        raise RuntimeError(f"R2 did not confirm the checksum metadata for {filename}")
    print(f"Uploaded verified {filename} to the immutable R2 key")


def cask_contents(version: str, checksums: dict[str, str]) -> str:
    return f'''cask "filezilla" do
  version "{version}"

  on_arm do
    sha256 "{checksums["arm"]}"

    url "{APP_URL.format(version=version, filename=f"FileZilla_{version}_macos-arm64.app.tar.bz2")}"
  end
  on_intel do
    sha256 "{checksums["intel"]}"

    url "{APP_URL.format(version=version, filename=f"FileZilla_{version}_macos-x86.app.tar.bz2")}"
  end

  name "FileZilla"
  desc "FTP, FTPS, and SFTP client"
  homepage "https://filezilla-project.org/"

  app "FileZilla.app"
end
'''


def propose_cask_update(version: str, checksums: dict[str, str]) -> None:
    new_contents = cask_contents(version, checksums)
    old_contents = CASK_PATH.read_text() if CASK_PATH.exists() else ""
    if old_contents == new_contents:
        print(f"FileZilla {version} is already current; no Cask PR is needed")
        return

    CASK_PATH.parent.mkdir(parents=True, exist_ok=True)
    CASK_PATH.write_text(new_contents)
    branch = f"automation/filezilla-{version}-{checksums['arm'][:8]}-{checksums['intel'][:8]}"
    run_git(["switch", "-c", branch])
    run_git(["add", str(CASK_PATH)])
    run_git(["commit", "-m", f"chore(cask): update FileZilla to {version}"])
    run_git(["push", "--force", "origin", f"HEAD:refs/heads/{branch}"])

    existing_pr = subprocess.run(
        ["gh", "pr", "list", "--repo", REPOSITORY, "--head", f"lbenicio:{branch}",
         "--state", "open", "--json", "number", "--jq", ".[0].number // empty"],
        check=False,
        capture_output=True,
        text=True,
        env=os.environ.copy(),
    )
    if existing_pr.returncode:
        raise RuntimeError("Could not check for an existing FileZilla update PR")
    if existing_pr.stdout.strip():
        print(f"Updated existing FileZilla Cask PR #{existing_pr.stdout.strip()}")
        return

    body = (
        f"## Summary\n\n"
        f"- Update the FileZilla Cask to {version}.\n"
        f"- Mirror the original Intel and Apple Silicon archives into the versioned R2 paths.\n"
        f"- Verify each archive against FileZilla's published SHA-512 manifest before upload.\n"
        f"- Pin each architecture's archive with SHA-256.\n\n"
        f"The Cask downloads the same upstream application archives through the existing read-only Worker."
    )
    create = subprocess.run(
        ["gh", "pr", "create", "--repo", REPOSITORY, "--base", "main", "--head", branch,
         "--title", f"chore(cask): update FileZilla to {version}", "--body", body],
        check=False,
        capture_output=True,
        text=True,
        env=os.environ.copy(),
    )
    if create.returncode:
        raise RuntimeError("Could not open the FileZilla Cask update PR")
    print("Opened a FileZilla Cask update PR")


def run_git(args: list[str]) -> None:
    result = subprocess.run(["git", *args], check=False, capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError("Could not prepare the FileZilla Cask update branch")


def main() -> int:
    version, links, checksum_url = release_metadata()
    filenames = {
        arch: f"FileZilla_{version}_{platform}.app.tar.bz2"
        for arch, platform in ARCHITECTURES.items()
    }
    manifest = fetch(checksum_url, referer=DOWNLOAD_PAGE)
    expected = {arch: expected_sha512(manifest, filename) for arch, filename in filenames.items()}
    checksums: dict[str, str] = {}

    # Validate R2 credentials before downloading or writing any release objects.
    r2_endpoint()
    with tempfile.TemporaryDirectory(prefix="filezilla-cask-") as temporary_directory:
        temporary = Path(temporary_directory)
        for arch, filename in filenames.items():
            print(f"Fetching and verifying FileZilla {version} for {arch}")
            archive_path = temporary / filename
            archive_path.write_bytes(fetch(links[arch], referer=DOWNLOAD_PAGE))
            sha256, _ = verify_archive(archive_path, filename, expected[arch])
            checksums[arch] = sha256
            mirror_archive(archive_path, version, filename, sha256)

    propose_cask_update(version, checksums)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except RuntimeError as error:
        print(f"FileZilla updater: {error}", file=sys.stderr)
        sys.exit(1)
