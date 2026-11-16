cask "slowquitapps" do
  version "0.8.2"
  sha256 "94ae490f7754926a7caa3275534bc6ee625b60a9349acb92fd18c829ef60e340"

  url "https://homebrew.lbenicio.dev/v1/downloads/slowquitapps/#{version}/SlowQuitApps-#{version}.dmg"
  name "SlowQuitApps"
  desc "Add a hold delay to the macOS Command-Q shortcut"
  homepage "https://github.com/dteoh/SlowQuitApps"

  depends_on macos: ">= :monterey"

  app "SlowQuitApps.app"

  caveats <<~EOS
    SlowQuitApps needs Accessibility access to observe keyboard events and handle Command-Q.
    Grant access under System Settings > Privacy & Security > Accessibility.

    This release is Developer ID-signed but not notarized, so macOS may warn on first launch.
  EOS
end
