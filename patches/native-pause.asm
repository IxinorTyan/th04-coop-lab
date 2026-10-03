; Use the original pause routine, text rendering and selection loop.
; Bridge bytes: enabled, requested, selection, active. Local play leaves enabled=0.
net_pause_state: db 0,0,0,0
net_pause_delay_ptr: dw 0x00d7,0x130e
net_pause_sense_ptr: dw 0x06bc,0x130e
net_pause_wait_ptr: dw 0x0133,0x130e

net_pause_enter:
    mov byte [cs:net_pause_state+3],1
    call ORIGINAL(0xb2cf)
    push ax
    call offline_apply ; a seat can disconnect while the native menu is open
    pop ax
    mov byte [cs:net_pause_state+3],0
    ret

net_pause_sense:
    cmp byte [cs:net_pause_state],0
    jne .network
    call far [cs:net_pause_sense_ptr]
    ret
.network:
    mov word [0x3974],0
    ret

net_pause_wait:
    cmp byte [cs:net_pause_state],0
    jne .network
    ; Original caller always passes zero; the near hook owns that argument.
    push word 0
    call far [cs:net_pause_wait_ptr]
    ret 2
.network:
    mov word [0x3974],0
.poll:
    push word 1
    call far [cs:net_pause_delay_ptr]
    cmp byte [cs:net_pause_state+1],0
    je .resume
    xor ax,ax
    mov al,[cs:net_pause_state+2]
    cmp ax,si
    je .poll
    ; Let the original routine toggle and redraw the highlighted item.
    mov word [0x3974],1
    ret 2
.resume:
    ; CANCEL always selects continue, even if the host highlighted quit.
    mov word [0x3974],0x1000
    ret 2
