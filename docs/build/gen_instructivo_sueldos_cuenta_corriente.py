# -*- coding: utf-8 -*-
"""Instructivo: Sueldos - cuenta corriente y pago mes a mes (estilo AgroCore)."""
import os
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph,
                                Table, TableStyle, ListFlowable, ListItem)

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUTDIR = os.path.join(BASE, "Instructivos")
LOGO = os.path.join(BASE, "..", "web", "img", "logo-full-256.png")

G900 = colors.HexColor("#14532d"); G700 = colors.HexColor("#15803d")
G600 = colors.HexColor("#16a34a"); G100 = colors.HexColor("#dcfce7")
AMBER_BG = colors.HexColor("#fef3c7"); AMBER_BD = colors.HexColor("#f59e0b"); AMBER_TX = colors.HexColor("#92400e")
BLUE_BG = colors.HexColor("#e0f2fe"); BLUE_BD = colors.HexColor("#38bdf8"); BLUE_TX = colors.HexColor("#075985")
SLATE = colors.HexColor("#475569")

styles = getSampleStyleSheet()
def S(name, **kw): return ParagraphStyle(name, parent=styles["Normal"], **kw)
st_title = S("t", fontName="Helvetica-Bold", fontSize=20, textColor=G900, spaceAfter=2, leading=24)
st_sub   = S("s", fontName="Helvetica", fontSize=11, textColor=SLATE, spaceAfter=10, leading=15)
st_intro = S("i", fontName="Helvetica", fontSize=10.5, textColor=colors.HexColor("#1f2937"), leading=16, spaceAfter=6)
st_h2    = S("h2", fontName="Helvetica-Bold", fontSize=13, textColor=G700, spaceBefore=12, spaceAfter=6, leading=17)
st_h3    = S("h3", fontName="Helvetica-Bold", fontSize=11.5, textColor=G900, spaceBefore=8, spaceAfter=3, leading=15)
st_step  = S("step", fontName="Helvetica", fontSize=10.5, textColor=colors.HexColor("#111827"), leading=16)
st_faq_q = S("faqq", fontName="Helvetica-Bold", fontSize=10.5, textColor=G900, leading=15, spaceBefore=6)
st_faq_a = S("faqa", fontName="Helvetica", fontSize=10.5, textColor=colors.HexColor("#1f2937"), leading=15)

KIND = {"g": (G100, G600, G900), "a": (AMBER_BG, AMBER_BD, AMBER_TX), "b": (BLUE_BG, BLUE_BD, BLUE_TX)}

def callout(text, kind="g"):
    bg, bd, tx = KIND[kind]
    p = Paragraph(text, S("c", fontName="Helvetica", fontSize=10, leading=15, textColor=tx))
    t = Table([[p]], colWidths=[165*mm])
    t.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,-1),bg),("BOX",(0,0),(-1,-1),1.2,bd),
        ("LEFTPADDING",(0,0),(-1,-1),10),("RIGHTPADDING",(0,0),(-1,-1),10),
        ("TOPPADDING",(0,0),(-1,-1),8),("BOTTOMPADDING",(0,0),(-1,-1),8)]))
    return t

def steps(items):
    return ListFlowable([ListItem(Paragraph(t, st_step), value=i+1, leftIndent=6) for i,t in enumerate(items)],
        bulletType="1", bulletFontName="Helvetica-Bold", bulletColor=G600, leftIndent=16,
        bulletFontSize=10.5, spaceBefore=2, spaceAfter=2)

def bullets(items):
    return ListFlowable([ListItem(Paragraph(t, st_step), leftIndent=6) for t in items],
        bulletType="bullet", bulletChar="•", bulletColor=G600, leftIndent=16,
        bulletFontSize=10.5, spaceBefore=1, spaceAfter=1)

def header_footer(canvas, doc):
    canvas.saveState(); w, h = A4
    canvas.setFillColor(G900); canvas.rect(0, h-24*mm, w, 24*mm, fill=1, stroke=0)
    try: canvas.drawImage(LOGO, 15*mm, h-21*mm, width=16*mm, height=13.7*mm, preserveAspectRatio=True, mask='auto')
    except Exception: pass
    canvas.setFillColor(colors.white); canvas.setFont("Helvetica-Bold", 13); canvas.drawString(34*mm, h-15*mm, "AgroCore")
    canvas.setFont("Helvetica", 10); canvas.drawRightString(w-15*mm, h-15*mm, "Instructivo")
    canvas.setStrokeColor(G100); canvas.setLineWidth(0.6); canvas.line(15*mm, 15*mm, w-15*mm, 15*mm)
    canvas.setFillColor(SLATE); canvas.setFont("Helvetica", 8)
    canvas.drawString(15*mm, 10*mm, "AgroCore - El corazón del negocio agrícola")
    canvas.drawRightString(w-15*mm, 10*mm, "Página %d" % doc.page)
    canvas.restoreState()

def build(filename, title, subtitle, blocks):
    out = os.path.join(OUTDIR, filename)
    doc = BaseDocTemplate(out, pagesize=A4, leftMargin=15*mm, rightMargin=15*mm, topMargin=30*mm, bottomMargin=20*mm)
    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id='f')
    doc.addPageTemplates([PageTemplate(id='main', frames=[frame], onPage=header_footer)])
    E = [Paragraph(title, st_title), Paragraph(subtitle, st_sub)]
    for kind, val in blocks:
        if kind == "intro":   E.append(Paragraph(val, st_intro))
        elif kind == "h2":    E.append(Paragraph(val, st_h2))
        elif kind == "h3":    E.append(Paragraph(val, st_h3))
        elif kind == "steps": E.append(steps(val))
        elif kind == "bullets": E.append(bullets(val))
        elif kind == "call":  E.append(callout(val[0], val[1]))
        elif kind == "faq":
            E.append(Paragraph("Preguntas frecuentes", st_h2))
            for q, a in val:
                E.append(Paragraph(q, st_faq_q)); E.append(Paragraph(a, st_faq_a))
    doc.build(E)
    print("PDF generado:", out)

# ============================================================
# SUELDOS: CUENTA CORRIENTE Y PAGO MES A MES
# ============================================================
build("Instructivo-Sueldos-Cuenta-Corriente.pdf",
  "Sueldos: cuenta corriente y pago mes a mes",
  "Cómo cargar sueldos que no se retiran completos y sueldos que cambian todos los meses",
  [
    ("intro", "La ficha del empleado ahora funciona como una <b>cuenta corriente</b>: lo que no se paga un mes queda como "
              "saldo y pasa solo al mes siguiente. Además, la ficha abre siempre en el mes actual."),
    ("h2", "1) Ver la ficha del mes"),
    ("steps", [
        "Entrá a <b>Administración &rarr; Empleados</b> y tocá el empleado.",
        "Se abre en el mes actual. Con las flechas del mes te podés mover a otro período.",
        "Arriba vas a ver el <b>Saldo a pagar (con arrastre)</b>.",
    ]),
    ("call", ("<b>Saldo a pagar (con arrastre)</b> = saldo del mes anterior (a favor o en contra) + lo que gana este mes "
              "(sueldo + premios) − gastos, adelantos y consumos del mes.", "g")),
    ("h2", "2) Registrar el pago (lo que realmente transferís)"),
    ("steps", [
        "Tocá <b>Registrar pago</b>.",
        "En <b>Monto que pagás ahora</b> viene sugerido el total adeudado, pero podés poner lo que realmente "
        "transferiste (menos o más).",
        "Elegí la fecha y el medio de pago (efectivo, transferencia, cheque, tarjeta).",
        "Confirmá. Abajo te avisa cuánto queda a favor o en contra: eso pasa solo al mes siguiente.",
    ]),
    ("call", ("<b>Ejemplo:</b> en septiembre el saldo a pagar da $500.000 (sueldo de agosto que quedó + septiembre). "
              "Transferís $450.000. Registrás el pago por $450.000. Quedan $50.000 a favor del empleado que "
              "aparecen arriba en octubre. Si en cambio retiró de más, queda debiendo y se le descuenta el mes que "
              "viene.", "g")),
    ("h2", "3) Sueldos que cambian todos los meses (administración, aumento de comercio)"),
    ("steps", [
        "En el mes que corresponda, tocá el botón <b>Sueldo del mes</b>.",
        "Viene sugerido el sueldo del mes anterior; escribí el valor nuevo de este mes y guardá.",
        "Ese sueldo queda fijo para ese mes. Cambiarlo más adelante no modifica los meses ya cargados.",
    ]),
    ("call", ("<b>Importante:</b> para sueldos que cambian NO uses el sueldo base de la ficha (ese se aplicaría a todos los "
              "meses). Usá siempre <b>Sueldo del mes</b>. Para los peones con sueldo fijo, sí alcanza con dejar el sueldo "
              "base en la ficha.", "a")),
    ("h2", "Resumen del circuito"),
    ("bullets", [
        "<b>No retiró todo el sueldo:</b> Registrar pago por lo que se llevó; el resto queda a favor y pasa al mes siguiente.",
        "<b>Retiró de más / adelanto grande:</b> Registrar pago por lo transferido; queda debiendo y se descuenta el mes que viene.",
        "<b>Sueldo distinto cada mes:</b> Usar 'Sueldo del mes' y poner el valor de ese mes (queda fijo).",
        "<b>Adelantos, compras, consumo kiosco:</b> Cargarlos como movimiento del mes; restan del saldo a pagar.",
    ]),
    ("faq", [
        ("¿Qué pasa con los sueldos viejos ya pagados?",
         "El arrastre empieza desde ahora. Los meses ya liquidados se toman como pagados completos (saldo 0)."),
        ("¿Puedo pagar el sueldo de agosto en septiembre?",
         "Sí. Registrás el pago en septiembre por ese monto; la cuenta corriente lo neutraliza sola."),
        ("¿Si me equivoco en un pago?",
         "Anulás la liquidación del mes (botón Anular) y la volvés a registrar con el monto correcto."),
    ]),
  ])
