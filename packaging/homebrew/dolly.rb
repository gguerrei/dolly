# The Homebrew formula for dolly, to be copied into a tap
# (github.com/gguerrei/homebrew-dolly, Formula/dolly.rb) with the two
# sha256 values filled in from the release's binaries (docs/RELEASING.md).
class Dolly < Formula
  desc "Save the way you build software as a pattern, then apply it anywhere"
  homepage "https://github.com/gguerrei/dolly"
  version "0.1.0"
  license "MIT"

  on_macos do
    on_arm do
      url "https://github.com/gguerrei/dolly/releases/download/v#{version}/dolly-macos-arm64"
      sha256 "REPLACE_WITH_THE_SHA256_OF_dolly-macos-arm64"
    end
  end

  on_linux do
    on_intel do
      url "https://github.com/gguerrei/dolly/releases/download/v#{version}/dolly-linux-x64"
      sha256 "REPLACE_WITH_THE_SHA256_OF_dolly-linux-x64"
    end
  end

  def install
    bin.install Dir["dolly-*"].first => "dolly"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/dolly --version")
  end
end
