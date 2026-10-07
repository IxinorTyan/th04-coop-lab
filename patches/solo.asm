; Original single-player adapter. No cooperative state, resource or scoring code.
bits 16
cpu 386
org 0x85f0
%define BASE 0xaaf0
%define ORIGINAL(a) (a-BASE)
dw init_hook, update_hook, render_hook, touch_move, pause_hook, world_hook, mailbox
mailbox:
    db 'TH04SOLOINPUTv1!'
ticks: dd 0
guest_ds: dw 0
mode: db 0                       ; 0 menu/transition, 1 play, 2 pause, 4 attract demo
flags: db 0                      ; bit 0 miss, bit 1 entry
generation: dw 0
point_options: db 1               ; bit 0 while focused, bit 3 always
    db 0
touch_state: times 8 db 0

clear_touch:
    mov word [cs:touch_state],0
    mov dword [cs:touch_state+2],0
    ret
publish:
    inc dword [cs:ticks]
    mov [cs:guest_ds],ds
    mov byte [cs:mode],1
    les bx,[0xba86]               ; original HUMAConfig resident
    cmp byte [es:bx+62],0         ; attract replay, never drive its player
    je .flags
    mov byte [cs:mode],4
    call clear_touch
.flags:
    xor ax,ax
    cmp byte [0x466a],0
    setne al
    cmp byte [0x4663],0
    setne ah
    shl ah,1
    or al,ah
    mov [cs:flags],al
    test al,al
    jz .done
    call clear_touch
.done:
    ret
init_hook:
    call ORIGINAL(0xb1d0)
    pushf
    pushad
    push es
    call clear_touch
    inc word [cs:generation]
    call publish
    pop es
    popad
    popf
    ret
update_hook:
    call ORIGINAL(0x10abf)
    pushf
    pushad
    push es
    call publish
    pop es
    popad
    popf
    ret
pause_hook:
    pushf
    mov byte [cs:mode],2
    call clear_touch
    popf
    call ORIGINAL(0xb2cf)         ; unmodified original pause menu
    pushf
    call clear_touch
    mov byte [cs:mode],1
    popf
    ret
world_hook:
    call ORIGINAL(0xab88)
    pushf
    mov byte [cs:mode],0
    call clear_touch
    popf
    ret
render_hook:
    call ORIGINAL(0x10bfd)        ; original single player sprite renderer
    pushf
    pushad
    push es
    cmp byte [cs:mode],1
    jne point_done
    cmp byte [cs:flags],0
    jne point_done
    test byte [cs:point_options],8
    jnz point_draw
    test byte [cs:point_options],1
    jz point_done
    cmp byte [0x3976],0
    je point_done
point_draw:
    mov ax,[0x464e]
    mov dx,[0x4650]
    sar ax,4
    add ax,32-2
    mov si,ax
    add dx,(16-2)*16
    push dx
    call ORIGINAL(0xbc10)
    imul di,ax,80
    mov cx,si
    and cx,7
    shr si,3
    add di,si
    mov ax,0x00f8
    ror ax,cl
    mov bx,ax
    mov ax,0xa800
    mov es,ax
    mov al,0xc0
    out 0x7c,al
    xor al,al
    out 0x7e,al
    out 0x7e,al
    out 0x7e,al
    out 0x7e,al
    push di
    mov cx,5
.outline:
    mov [es:di],bx
    call point_row
    loop .outline
    pop di
    mov ax,bx
    rol ax,1
    and ax,bx
    ror bx,1
    and bx,ax
    mov al,0xff
    out 0x7e,al
    out 0x7e,al
    out 0x7e,al
    out 0x7e,al
    call point_row
    mov cx,3
.center:
    mov [es:di],bx
    call point_row
    loop .center
    xor al,al
    out 0x7c,al
point_done:
    pop es
    popad
    popf
    ret
point_row:
    add di,80
    cmp di,32000
    jb .done
    sub di,32000
.done:
    ret
; Build extracts only the existing bounded direct-touch movement routine.
; None of the cooperative mailbox, status or player-bank routines is included.
%include 'build/solo-touch.inc'
