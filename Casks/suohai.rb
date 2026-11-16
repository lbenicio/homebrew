cask "suohai" do
  version "0.1.0"
  sha256 "347c7224c8073626590fe3f9536749d48cd6eb00132e242b4b2af8aa1dc06aca"

  url "https://homebrew.lbenicio.dev/v1/downloads/suohai/#{version}/Suohai.dmg"
  name "Suohai"
  desc "Keep selected system audio input and output devices set as defaults"
  homepage "https://github.com/lbenicio/suohai"

  app "Suohai.app"

  caveats <<~EOS
    Requires macOS 27 or later. This release is not Developer ID-signed or notarized, so macOS may warn when you first open it.
  EOS
end
