{
  description = "javascript framework";
  inputs.nixpkgs.url = "github:nixos/nixpkgs/nixos-unstable";
  inputs.flake-utils.url = "github:numtide/flake-utils";
  inputs.zig.url = "github:mitchellh/zig-overlay";
  inputs.zls.url = "github:zigtools/zls";

  outputs = { self, nixpkgs, flake-utils, zig, zls }:
    flake-utils.lib.eachDefaultSystem (system: let
      pkgs = import nixpkgs {
        inherit system;
      };
    in {
      devShell = pkgs.mkShell {
        buildInputs = [
          zls.packages.${system}.default
          zig.packages.${system}.master
          pkgs.bun
        ];
      };
    });
}
