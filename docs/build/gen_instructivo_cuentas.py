# -*- coding: utf-8 -*-
"""Genera el Instructivo 'Acomodar cuentas bancarias' en PDF (estilo AgroCore)."""
import os
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph,
                                Spacer, Table, TableStyle, ListFlowable, ListItem)
from reportlab.lib.enums import TA_LEFT

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(BASE, "Instructivos", "Instructivo-Acomodar-Cuentas-Bancarias.pdf")
LOGO = os.path.join(BASE, "..", "web", "img", "logo-full-256.png")

# Paleta AgroCore
G900 = colors.HexColor("#14532d"); G700 = colors.HexColor("#15803d")
G600 = colors.HexColor("#16a34a"); G100 = colors.HexColor("#dcfce7")
AMBER_BG = colors.HexColor("#fef3c7"); AMBER_BD = colors.HexColor("#f59e0b"); AMBER_TX = colors.HexColor("#92400e")
BLUE_BG = colors.HexColor("#e0f2fe"); BLUE_BD = colors.HexColor("#38bdf8"); BLUE_TX = colors.HexColor("#075985")
SLATE = colors.HexColor("#475569")

styles = getSampleStyleSheet()
def S(name, **kw):
    return ParagraphStyle(name, parent=styles["Normal"], **kw)

st_title = S("t", fontName="Helvetica-Bold", fontSize=22, textColor=G900, spaceAfter=2, leading=26)
st_sub   = S("s", fontName="Helvetica", fontSize=11, textColor=SLATE, spaceAfter=10, leading=15)
st_intro = S("i", fontName="Helvetica", fontSize=10.5, textColor=colors.HexColor("#1f2937"), leading=16, spaceAfter=6)
st_h2    = S("h2", fontName="Helvetica-Bold", fontSize=13.5, textColor=G700, spaceBefore=12, spaceAfter=6, leading=17)
st_step  = S("step", fontName="Helvetica", fontSize=10.5, textColor=colors.HexColor("#111827"), leading=16)
st_box   = S("box", fontName="Helvetica", fontSize=10, leading=15)
st_faq_q = S("faqq", fontName="Helvetica-Bold", fontSize=10.5, textColor=G900, leading=15, spaceBefore=6)
st_faq_a = S("faqa", fontName="Helvetica", fontSize=10.5, textColor=colors.HexColor("#1f2937"), leading=15)

def callout(text, bg, bd, tx):
    p = Paragraph(text, S("c", fontName="Helvetica", fontSize=10, leading=15, textColor=tx))
    t = Table([[p]], colWidths=[165*mm])
    t.setStyle(TableStyle([
        ("BACKGROUND",(0,0),(-1,-1),bg),
        ("BOX",(0,0),(-1,-1),1.2,bd),
        ("LEFTPADDING",(0,0),(-1,-1),10),("RIGHTPADDING",(0,0),(-1,-1),10),
        ("TOPPADDING",(0,0),(-1,-1),8),("BOTTOMPADDING",(0,0),(-1,-1),8),
    ]))
    return t

def steps(items):
    return ListFlowable(
        [ListItem(Paragraph(t, st_step), value=i+1, leftIndent=6) for i,t in enumerate(items)],
        bulletType="1", bulletFontName="Helvetica-Bold", bulletColor=G600,
        leftIndent=16, bulletFontSize=10.5, spaceBefore=2, spaceAfter=2,
    )

def header_footer(canvas, doc):
    canvas.saveState()
    w, h = A4
    # Barra superior verde
    canvas.setFillColor(G900); canvas.rect(0, h-24*mm, w, 24*mm, fill=1, stroke=0)
    try:
        canvas.drawImage(LOGO, 15*mm, h-21*mm, width=16*mm, height=13.7*mm,
                         preserveAspectRatio=True, mask='auto')
    except Exception:
        pass
    canvas.setFillColor(colors.white); canvas.setFont("Helvetica-Bold", 13)
    canvas.drawString(34*mm, h-15*mm, "AgroCore")
    canvas.setFont("Helvetica", 10)
    canvas.drawRightString(w-15*mm, h-15*mm, "Instructivo")
    # Pie
    canvas.setStrokeColor(G100); canvas.setLineWidth(0.6)
    canvas.line(15*mm, 15*mm, w-15*mm, 15*mm)
    canvas.setFillColor(SLATE); canvas.setFont("Helvetica", 8)
    canvas.drawString(15*mm, 10*mm, "AgroCore — El corazón del negocio agrícola")
    canvas.drawRightString(w-15*mm, 10*mm, "Página %d" % doc.page)
    canvas.restoreState()

def build():
    doc = BaseDocTemplate(OUT, pagesize=A4,
                          leftMargin=15*mm, rightMargin=15*mm, topMargin=30*mm, bottomMargin=20*mm)
    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id='f')
    doc.addPageTemplates([PageTemplate(id='main', frames=[frame], onPage=header_footer)])
    E = []
    E.append(Paragraph("Cómo acomodar las cuentas del banco", st_title))
    E.append(Paragraph("Corregir un resumen que se importó con montos desacomodados", st_sub))
    E.append(Paragraph(
        "Se cargó un resumen del banco con una versión anterior del sistema que, con ese tipo de "
        "resumen, tomaba mal los importes (agarraba la columna <b>Saldo</b> en lugar del <b>Importe</b>). "
        "Por eso los saldos quedaron desacomodados. <b>Ya está corregido</b> y lo podés arreglar vos misma "
        "en 2 pasos, sin borrar nada a mano. Los movimientos que cargaste <b>a mano</b> (transferencias, "
        "cheques, etc.) <b>no se tocan</b>: solo se limpia lo que entró por la importación.", st_intro))
    E.append(callout("<b>Importante:</b> hacelo <b>una cuenta a la vez</b> y fijate el saldo después de cada paso.", AMBER_BG, AMBER_BD, AMBER_TX))
    E.append(Spacer(1, 4))

    E.append(Paragraph("PARTE 1 &nbsp;&mdash;&nbsp; Borrar lo que se cargó mal", st_h2))
    E.append(steps([
        "Entrá a <b>Bancos</b>.",
        "<b>Abrí la cuenta</b> que quedó mal (por ejemplo la que termina en <b>8216</b>, que debería estar en cero).",
        "Arriba a la derecha, tocá el botón de <b>volver atrás</b> (la flechita curva, está al lado del botón \"Importar resumen\").",
        "Se abre una ventana. Si esa cuenta tiene importaciones viejas, vas a ver un recuadro <b>amarillo</b> que dice <b>\"Importaciones anteriores\"</b> con la cantidad de movimientos.",
        "Tocá <b>\"Borrar todo\"</b> y confirmá con <b>Aceptar</b>.",
        "Listo: se borran <b>solo</b> esos movimientos importados. La cuenta vuelve a como estaba (la 8216 en <b>cero</b>, la otra en <b>$600.000</b>, etc.).",
        "Cerrá la ventana y <b>mirá el saldo</b> de la cuenta arriba: tiene que quedar como en el banco.",
    ]))
    E.append(Spacer(1, 4))
    E.append(callout("<b>Repetí la Parte 1 en cada cuenta</b> que haya quedado desacomodada.", G100, G600, G900))

    E.append(Paragraph("PARTE 2 &nbsp;&mdash;&nbsp; Volver a importar el resumen (ahora sí, bien)", st_h2))
    E.append(steps([
        "Con la cuenta abierta, tocá <b>\"Importar resumen\"</b>.",
        "Subí <b>el mismo PDF</b> del resumen de esa cuenta (o el Excel/CSV si tu banco lo da; también sirve una <b>foto</b> si lo tenés en papel).",
        "El sistema <b>verifica que el resumen sea de esa cuenta</b>: si el aviso es <b>verde</b> es la correcta; si es <b>rojo/amarillo</b> es de otra cuenta, cerralo y abrí la que corresponde.",
        "Revisá la lista de movimientos (fecha, concepto, tipo e importe): ahora los importes tienen que estar <b>bien</b> (chicos y con signo: negativo = sale, positivo = entra).",
        "Tocá <b>\"Importar seleccionados\"</b>.",
        "Te muestra cuántos se cargaron. <b>Verificá el saldo final</b> de la cuenta: tiene que coincidir con el del banco.",
    ]))
    E.append(Spacer(1, 4))
    E.append(callout("<b>Tip:</b> si algo no cuadra, en el aviso del final tenés <b>\"Deshacer importación\"</b> "
                     "para volver atrás al toque y probar de nuevo.", BLUE_BG, BLUE_BD, BLUE_TX))

    E.append(Paragraph("Preguntas frecuentes", st_h2))
    faqs = [
        ("&#191;Se borran los movimientos que cargué a mano?",
         "No. El botón \"Borrar todo\" solo elimina lo que entró por <b>importación de resumen</b>. Lo que cargaste vos (transferencias, cheques, depósitos) queda intacto."),
        ("Me dice que el mes está \"conciliado\" y no me deja borrar.",
         "Andá a <b>Conciliar mes</b>, reabrí ese mes, borrá/reimportá, y después volvé a conciliar."),
        ("No me aparece el recuadro amarillo \"Importaciones anteriores\".",
         "Quiere decir que esa cuenta no tiene importaciones viejas para limpiar (o ya las borraste). Podés importar directamente."),
        ("&#191;Puedo subir una foto del resumen en papel?",
         "Sí. En \"Importar resumen\" elegí la foto (JPG/PNG). La lee la inteligencia artificial."),
    ]
    for q,a in faqs:
        E.append(Paragraph(q, st_faq_q))
        E.append(Paragraph(a, st_faq_a))
    E.append(Spacer(1, 8))
    E.append(Paragraph("Cualquier cosa, escribinos y lo vemos juntos.", st_intro))

    doc.build(E)
    print("PDF generado:", OUT)

if __name__ == "__main__":
    build()
