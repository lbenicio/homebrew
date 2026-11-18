cask "lbenicio-qlimagesize" do
  version "3.0"
  sha256 "f15f77188fa1fa18e8c652990a113246c36ab192f93412322471c9d6cd11ddc5"

  url "https://homebrew.lbenicio.dev/v1/downloads/qlimagesize/#{version}/Quick-Look-Image-Size-#{version}-UNSIGNED.dmg"
  name "Quick Look Image Size"
  desc "Quick Look previews and Finder thumbnails with image dimensions"
  homepage "https://github.com/lbenicio/qlImageSize"

  depends_on macos: ">= :monterey"

  app "Quick Look Image Size.app"

  zap trash: [
    "~/Library/Containers/fr.whine.qlimagesize",
    "~/Library/Preferences/fr.whine.qlimagesize.plist",
  ]

  caveats <<~EOS
    This is an unsigned, non-notarized build. macOS may warn or prevent it from opening.

    Open the app once, then enable Quick Look Image Size under
    System Settings > General > Login Items & Extensions > Quick Look.
  EOS
end
