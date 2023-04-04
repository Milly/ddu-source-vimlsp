# ddu-source-vimlsp

[vim-lsp][https://github.com/prabirshrestha/vim-lsp] source for ddu.vim

This source collects the location list of vim-lsp.

## Required

### vim-lsp

https://github.com/prabirshrestha/vim-lsp

### denops.vim

https://github.com/vim-denops/denops.vim

### ddu.vim

https://github.com/Shougo/ddu.vim

### ddu-kind-file

https://github.com/Shougo/ddu-kind-file

## Configuration example

```vim
nmap <Plug>(ddu-vimlsp-implementation) <Cmd>call DduLspCursor('implementation')<CR>
nmap <Plug>(ddu-vimlsp-references)     <Cmd>call DduLspCursor('references')<CR>

function! DduLspCursor(method) abort
  call ddu#start(#{ sources: [#{
  \  name: 'vimlsp',
  \  params: #{
  \    method: a:method,
  \    textDocument: lsp#get_text_document_identifier(),
  \    position: lsp#get_position(),
  \  },
  \}] })
endfunction
```
