//go:build ignore

// Command go-docstrings reports exported Go declarations that carry no doc
// comment.
//
// The analysis runs through go/parser and go/ast rather than a textual scan. A
// regular expression would misread grouped declarations, type parameters, and
// comments detached from the declaration they document — and a parser that
// guesses does not fail loudly, it reports findings that are wrong.
//
// File paths arrive as arguments, one JSON array of findings leaves on stdout,
// and a file that cannot be read or parsed becomes a finding rather than
// aborting the run, because a syntax error is something the author needs to see.
//
// The build tag keeps this file out of `go build ./...` and `go vet ./...` in
// the repository it ships with, while `go run scripts/gates/go-docstrings.go`
// still compiles and runs it.
package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"go/ast"
	"go/parser"
	"go/scanner"
	"go/token"
	"os"
	"path/filepath"
	"strings"
)

// finding is one undocumented declaration, or one file the analysis could not
// read, shaped for the reporter in verify-go-docstrings.mjs.
type finding struct {
	File   string `json:"file"`
	Line   int    `json:"line"`
	Name   string `json:"name"`
	Kind   string `json:"kind"`
	Detail string `json:"detail"`
}

// packageDocs answers, per directory and package name, whether some file
// already carries the package comment.
//
// The package comment documents the package rather than the file, and it
// conventionally lives in doc.go, which a --staged run rarely contains. Reading
// the rest of the directory keeps that run from reporting a package that is in
// fact documented.
type packageDocs struct {
	fset       *token.FileSet
	documented map[string]bool
}

// newPackageDocs creates an empty record.
//
// Parameters:
//   - fset: the file set the caller parsed with.
//
// Returns a record that has seen no file yet.
func newPackageDocs(fset *token.FileSet) *packageDocs {
	return &packageDocs{fset: fset, documented: map[string]bool{}}
}

// packageKey identifies a package by its directory and name.
//
// Parameters:
//   - path: path of a file in the package.
//   - name: the package name declared in it.
//
// Returns a key unique to that package within the run.
func packageKey(path string, name string) string {
	return filepath.Dir(path) + "\x00" + name
}

// seed records the package comment of a file the run was given.
//
// Parameters:
//   - path: path of the file.
//   - file: its parsed syntax tree.
func (p *packageDocs) seed(path string, file *ast.File) {
	if file.Doc != nil {
		p.documented[packageKey(path, file.Name.Name)] = true
	}
}

// has reports whether the package of a file carries a package comment,
// including in a sibling file the run was not given.
//
// Parameters:
//   - path: path of the file.
//   - file: its parsed syntax tree.
//
// Returns true when the package is documented.
func (p *packageDocs) has(path string, file *ast.File) bool {
	key := packageKey(path, file.Name.Name)
	if p.documented[key] {
		return true
	}
	dir := filepath.Dir(path)
	entries, err := os.ReadDir(dir)
	if err != nil {
		return false
	}
	for _, entry := range entries {
		name := entry.Name()
		if entry.IsDir() || !strings.HasSuffix(name, ".go") || strings.HasSuffix(name, "_test.go") {
			continue
		}
		if entry.Name() == filepath.Base(path) {
			continue
		}
		// PackageClauseOnly stops at the package clause, which is the whole
		// question here.
		sibling, err := parser.ParseFile(p.fset, filepath.Join(dir, name), nil, parser.PackageClauseOnly|parser.ParseComments)
		if err != nil || sibling.Name.Name != file.Name.Name || sibling.Doc == nil {
			continue
		}
		p.documented[key] = true
		return true
	}
	return false
}

// checkFile reports every exported declaration in one parsed file that carries
// no doc comment.
//
// Parameters:
//   - path: path of the file.
//   - file: its parsed syntax tree.
//   - packages: the package-comment record, already seeded with every file.
//
// Returns the findings for that file, in source order.
func checkFile(fset *token.FileSet, path string, file *ast.File, packages *packageDocs) []finding {
	out := []finding{}
	if !packages.has(path, file) {
		out = append(out, finding{path, fset.Position(file.Package).Line, "<package>", "package", "no package doc comment"})
	}
	for _, decl := range file.Decls {
		switch d := decl.(type) {
		case *ast.GenDecl:
			out = append(out, checkGenDecl(fset, path, d)...)
		case *ast.FuncDecl:
			if found := checkFunc(fset, path, d); found != nil {
				out = append(out, *found)
			}
		}
	}
	return out
}

// checkGenDecl reports exported types, constants, and variables in one
// declaration that carry no doc comment. A comment on the declaration
// documents every name in a grouped `const`, `var`, or `type` block.
//
// Parameters:
//   - path: path of the file.
//   - decl: the declaration.
//
// Returns the findings for that declaration, in source order.
func checkGenDecl(fset *token.FileSet, path string, decl *ast.GenDecl) []finding {
	out := []finding{}
	switch decl.Tok {
	case token.TYPE:
		for _, spec := range decl.Specs {
			typed, ok := spec.(*ast.TypeSpec)
			if !ok || !ast.IsExported(typed.Name.Name) || typed.Doc != nil || decl.Doc != nil {
				continue
			}
			out = append(out, finding{path, fset.Position(typed.Pos()).Line, typed.Name.Name, "type", "no doc comment"})
		}
	case token.CONST, token.VAR:
		kind := "constant"
		if decl.Tok == token.VAR {
			kind = "variable"
		}
		for _, spec := range decl.Specs {
			values, ok := spec.(*ast.ValueSpec)
			if !ok || values.Doc != nil || decl.Doc != nil {
				continue
			}
			for _, name := range values.Names {
				if !ast.IsExported(name.Name) {
					continue
				}
				out = append(out, finding{path, fset.Position(name.Pos()).Line, name.Name, kind, "no doc comment"})
			}
		}
	}
	return out
}

// checkFunc reports an exported function or method without a doc comment.
//
// A method on an unexported receiver is reported too: a constructor can return
// that type, and the method is then callable from outside the package.
//
// Parameters:
//   - path: path of the file.
//   - decl: the function or method declaration.
//
// Returns the finding, or nil when the declaration is private or documented.
func checkFunc(fset *token.FileSet, path string, decl *ast.FuncDecl) *finding {
	if decl.Doc != nil || !ast.IsExported(decl.Name.Name) {
		return nil
	}
	kind := "function"
	name := decl.Name.Name
	if decl.Recv != nil {
		kind = "method"
		name = receiverName(decl.Recv) + "." + name
	}
	return &finding{path, fset.Position(decl.Pos()).Line, name, kind, "no doc comment"}
}

// receiverName names a receiver's type without its pointer, type parameters, or
// package qualifier: `*Store[T]` becomes `Store`.
//
// Parameters:
//   - recv: the receiver list of a method declaration.
//
// Returns the type name, or `<receiver>` when it is not a named type.
func receiverName(recv *ast.FieldList) string {
	if recv == nil || len(recv.List) == 0 {
		return "<receiver>"
	}
	expr := recv.List[0].Type
	if star, ok := expr.(*ast.StarExpr); ok {
		expr = star.X
	}
	switch typed := expr.(type) {
	case *ast.Ident:
		return typed.Name
	case *ast.IndexExpr:
		if ident, ok := typed.X.(*ast.Ident); ok {
			return ident.Name
		}
	case *ast.IndexListExpr:
		if ident, ok := typed.X.(*ast.Ident); ok {
			return ident.Name
		}
	}
	return "<receiver>"
}

// syntaxFinding turns a parse failure into a finding at the first error position.
//
// A file that does not parse is a fact the author needs to see, not a reason to
// abort the run: reporting it keeps one broken file from hiding every other
// finding in the same change.
//
// Parameters:
//   - path: path of the file that failed to parse.
//   - err: the error parser.ParseFile returned.
//
// Returns a finding carrying the first error position and message when the
// parser reported one, and the error text otherwise.
func syntaxFinding(path string, err error) *finding {
	var list scanner.ErrorList
	if errors.As(err, &list) && len(list) > 0 {
		first := list[0]
		return &finding{path, first.Pos.Line, "<syntax error>", "syntax", first.Msg}
	}
	return &finding{path, 1, "<syntax error>", "syntax", err.Error()}
}

// main reads the file paths in the arguments and writes the findings as JSON.
func main() {
	fset := token.NewFileSet()
	paths := os.Args[1:]
	// The separator keeps the toolchain from reading the path arguments as source
	// files, and arrives here as a literal "--".
	if len(paths) > 0 && paths[0] == "--" {
		paths = paths[1:]
	}
	type read struct {
		path    string
		file    *ast.File
		finding *finding
	}
	reads := make([]read, 0, len(paths))
	packages := newPackageDocs(fset)

	for _, path := range paths {
		source, err := os.ReadFile(path)
		if err != nil {
			reads = append(reads, read{path: path, finding: &finding{path, 1, "<unreadable>", "io", err.Error()}})
			continue
		}
		file, err := parser.ParseFile(fset, path, source, parser.ParseComments|parser.SkipObjectResolution)
		if err != nil {
			reads = append(reads, read{path: path, finding: syntaxFinding(path, err)})
			continue
		}
		reads = append(reads, read{path: path, file: file})
		packages.seed(path, file)
	}

	findings := []finding{}
	for _, r := range reads {
		if r.finding != nil {
			findings = append(findings, *r.finding)
			continue
		}
		findings = append(findings, checkFile(fset, r.path, r.file, packages)...)
	}

	encoder := json.NewEncoder(os.Stdout)
	if err := encoder.Encode(findings); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
